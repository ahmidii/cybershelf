# Recovery copies of uploaded files

`lib/server/original-backups.ts` copies committed uploads from the serving `BUCKET` into a separate, private `BACKUP_BUCKET`. Both ebook originals and uploaded artwork are included. The serving application has no download route for the backup bucket. This job does not export passwords, sessions, or the database; D1 recovery is a separate operation.

## Keys, integrity, and retention

An asset keeps the same opaque key in both buckets: `private/as_<random-id>`. The recovered D1 `assets` table is the file map. There is no second manifest containing reader identities or filenames. Copies retain the asset MIME type and discard other source HTTP metadata and all custom metadata.

The job streams the original body directly into R2 without buffering an entire book in the Worker. It verifies the original object's size against D1, passes an available genuine R2 checksum to the destination write, and checks the returned size and checksum. It does not treat an ETag as an MD5 digest. When a source object has no exposed checksum, verification is limited to the confirmed write and size; ordinary R2 uploads expose a checksum. A missing live source or a size mismatch is a failed backup, not an empty successful copy.

These are refreshed copies of immutable files, not a version history. Successful daily scans overwrite the same backup keys. Configure a **30-day expiry lifecycle** on the private backup bucket so active copies are refreshed and copies of removed files eventually expire. The interval runs from the last successful backup write; it is not immediate erasure when someone removes a file or account. An already-running copy can finish after an account deletion. No application path can serve that recovery copy.

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

1. Preserve the latest available account-erasure ledger and pending deletion jobs outside the database version being restored.
2. Reconcile those records into the recovered database and remove erased accounts and their associated records. A historical D1 restore must not resurrect an account that was deleted later.
3. Use the surviving `assets.object_key` and `assets.size` records to select recovery objects. Refuse keys belonging to an erased account or a pending account deletion.
4. Stream each selected backup into the staging serving bucket. Verify sizes and available checksums, then confirm ordinary authenticated download, publication visibility, and account deletion behavior in staging.
5. Record missing files and the actual recoverable point before deciding whether to reopen traffic.

The backup job itself excludes owners found in either the deletion-job table or the erasure ledger, even if an old database still contains their assets. It does not replace the reconciliation step: restoring an older D1 snapshot can also restore an older copy of the ledger.

`lib/server/original-backups.integration.mjs` exercises the production helper against an isolated migrated D1 database and two disposable R2 buckets. It covers lost copy acknowledgements, durable retries, partial-scan freshness, missing primary objects, lease fencing, erasure exclusion, and a synthetic file copied back byte for byte. Its host-side Miniflare bridge accepts only synthetic bodies of at most 512 bytes because the Node proxy does not preserve the length metadata of R2 streams; native streaming needs the separate scheduled Worker check. **Passing a local drill does not establish that production backups, lifecycle settings, administrator access, or a production restore have been verified.** Record those checks separately in the operations runbook.
