# Recovery copies of uploaded files

`lib/server/original-backups.ts` copies committed uploads from the serving `BUCKET` into a separate, private `BACKUP_BUCKET`. Ebook originals, personal artwork and eligible community contribution copies are included. The serving application has no download route for the backup bucket. This job does not export passwords, sessions, or the database; D1 recovery is a separate operation.

## Keys, integrity, and retention

An asset keeps the same opaque key in both buckets: `private/as_<random-id>`. The recovery file map combines reconciled D1 `assets` records for personal files and `community_assets` records for separate contributed copies. A contribution's public `id` is distinct from its `storage_id`; its immutable `object_key` is `private/` plus that storage ID. Its private source upload and its shared copy have different storage records and lifecycles. There is no second file manifest containing reader identities or filenames. Copies retain the asset MIME type and discard other source HTTP metadata and all custom metadata.

The copier includes personal assets only for active accounts, pending shared copies only for active contributors, and approved shared copies even when the contributor relationship has been removed after account deletion. It excludes any shared asset named in `community_asset_erasures`, and never selects rejected or withdrawn contributions. An approved copy can still be hidden by moderation: retaining its bytes in private recovery storage does not authorize public display. Curated decorations shipped in `public/decor-catalogue/` are release files, not R2 uploads; recover them from the matching application release.

The job streams the original body directly into R2 without buffering an entire book in the Worker. It verifies the original object's size against D1, passes an available genuine R2 checksum to the destination write, and checks the returned size and checksum. It does not treat an ETag as an MD5 digest. When a source object has no exposed checksum, verification is limited to the confirmed write and size; ordinary R2 uploads expose a checksum. A missing live source or a size mismatch is a failed backup, not an empty successful copy.

These are refreshed copies of immutable files, not a version history. Successful daily scans overwrite the same backup keys. Configure a **30-day expiry lifecycle** on the private backup bucket so active copies are refreshed and copies of removed files eventually expire. The interval runs from the last successful backup write; it is not immediate erasure when someone removes a file or account. Account deletion stops refresh of personal files and pending contributions; explicitly consented approved contributions continue as independent shared records with `contributor_id=NULL`. Withdrawal or rejection stops refresh of the shared copy. An already-running copy can finish after a deletion or withdrawal. No application path can serve that recovery copy.

Do not put a blanket expiry lifecycle on the serving bucket: its zero-byte cancellation barriers have a different purpose, described in [upload storage](./upload-storage.md).

## Scheduling and limits

The scheduler calls `backupOriginalAssets` every five minutes using `2-59/5 * * * *` (minutes 02, 07, 12, and so on, in UTC). Housekeeping uses `*/5 * * * *` in separate invocations, so the two jobs do not consume the same invocation's query and subrequest budget. A daily scan advances in bounded chunks and starts another pass 24 hours after the previous pass began.

| Bound | Default |
| --- | --- |
| Files processed per invocation | 10 |
| Bytes copied per invocation | 64 MiB |
| Maximum individual file size | 25 MiB |
| Time budget for starting/copying work | 50 seconds |
| Durable lease | 10 minutes, renewed with checkpoints |
| Retry delay after failures | 1 minute, doubling to at most 1 hour |
| Fresh completed-scan coverage | At most 30 hours old |

Each copied file normally needs two R2 operations and two D1 calls, in addition to roughly five setup, selection, and release calls per invocation. Account-level resource and storage limits still apply across both schedules. The five-minute backup schedule permits a theoretical maximum of **2,880 files or 18 GiB per day**, whichever limit binds first; errors, delays, and provider limits reduce throughput. Increase capacity before a full scan approaches a day. Do not silently relax stale-backup alerts to accommodate a growing queue.

Newly committed uploads wait for the next daily pass if they arrive after its cutoff. The recovery point can therefore lag a new upload by **24 hours plus scan duration and queue delays**. This is a periodic recovery copy, not synchronous replication. A completed scan is not an atomic snapshot spanning D1 and R2. D1 can recover metadata newer than the corresponding file backup; validate every referenced file before reopening a restored site.

## Durable state and health

`maintenance_state` contains one JSON row keyed `original-backups.v1`. It records the scan cursor, file/byte counters, start and completion times, a lease token, and bounded failure codes. It contains no filenames, account identities, credentials, or file contents. Compare-and-swap updates fence stale workers. A crash or ambiguous storage response leaves the last confirmed cursor; a retry may copy the same immutable bytes again.

Only a full successful pass updates `completedAt` and `completedScanStartedAt`. The status reader uses the scan's **start time** as its conservative coverage timestamp. A fresh row update or a recent partial copy does not establish that backups are current. A first partial scan still reports `never_completed`; a failed pass reports `failed`; old completed coverage reports `stale`.

`originalBackupStatus` exposes these operational fields without the asset cursor. Missing bindings disable copying. Misconfigured identical bucket objects, invalid state, missing originals, failed verification, provider failures, and timeouts fail closed. Actual bucket names and private-access/lifecycle settings still require a Cloudflare operations check.

## Restore requirements

Restore into private staging resources first, following the operations runbook. Before recovering files or serving a restored database:

1. Preserve the latest `account_erasure_ledger`, `account_deletion_jobs`, `asset_transfers` and `community_asset_erasures` outside the database version being restored. Also preserve the complete current `community_assets`, `community_asset_editions` and `community_asset_reviews` records, plus current `moderation_hidden` and `account_suspensions` state. Preserve current authentication/security state as required by the operations runbook. An older snapshot alone cannot establish whether an image was subsequently approved, withdrawn or hidden.
2. Merge both erasure ledgers without shortening retention and use current shared catalogue decisions when reconciling erased accounts. Remove personal files and non-approved contributions of erased or deleting accounts. Preserve approved contributions only with their explicit `community-assets-v1` consent evidence, stable storage identity and current public credit; remove the erased contributor relationship. An approval made after the selected content backup must not be undone by deleting what the older snapshot calls a pending copy. Keep asset-level moderation hides when detaching a contributor, including hides created when a suspended contributor deleted their account.
3. Build the file manifest from eligible `assets` **and** `community_assets` rows after reconciliation. Exclude erased/deleting personal owners, pending contributions without a surviving active contributor, rejected/withdrawn shared rows, and every shared asset or storage ID in the current erasure ledger even if an old snapshot says approved. Never infer recovery permission from a bucket listing. Missing current asset state, conflicting immutable IDs or missing consent blocks promotion of that asset; hold it unavailable until resolved.
4. Stream each selected backup into the private staging serving bucket. Verify sizes and available checksums; for contributed copies compare bytes with `community_assets.content_hash` (SHA-256). Preserve edition aliases and current review decisions. Approved hidden copies may remain in private storage, but their image/catalogue routes must remain hidden; a null contributor ID must not bypass a retained asset-level hide.
5. Check ordinary authenticated downloads, shared-artwork visibility and account deletion in staging. Confirm retained shared copies still work without recreating deleted accounts, and that withdrawn/rejected/pending-erased copies have neither serving bytes nor accessible image routes. Record missing files and the actual recoverable point before deciding whether to reopen traffic.
6. Reconcile any newer erasure, approval, withdrawal or moderation events again before traffic resumes. Keep both ledgers longer than every recoverable database/export/file copy; their current 35-day retention must be extended before attempting recovery from older retained material.

The backup job's eligibility checks do not replace restoration reconciliation: an older D1 snapshot can restore older ledgers and old approval/visibility flags. Account erasure applies to personal records and pending copies; a deliberately retained, approved shared contribution is an independent record. Its continued existence must never recreate the erased contributor link or override a withdrawal or moderation decision.

`lib/server/original-backups.integration.mjs` exercises the production helper against an isolated migrated D1 database and two disposable R2 buckets. It covers lost copy acknowledgements, durable retries, partial-scan freshness, missing primary objects, lease fencing, erasure exclusion, and a synthetic file copied back byte for byte. Its host-side Miniflare bridge accepts only synthetic bodies of at most 512 bytes because the Node proxy does not preserve the length metadata of R2 streams; native streaming needs the separate scheduled Worker check. **Passing a local drill does not establish that production backups, lifecycle settings, administrator access, or a production restore have been verified.** Record those checks separately in the operations runbook.

`tests/operations.test.mjs` separately restores an older synthetic SQLite snapshot and reconciles later shared-asset decisions. It checks withdrawn/rejected bytes are excluded, approved contributions survive contributor deletion without the account link, pending copies are erased, post-backup approvals and edition aliases survive, and later moderation hides remain effective. It also rejects missing current asset evidence and corrupt bytes, and repeats reconciliation to verify idempotence. This fixture uses only temporary local databases and synthetic byte maps.
