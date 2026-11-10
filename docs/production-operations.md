# Production operations and recovery

This runbook applies to the standalone Cybershelf Worker, D1 database and private R2 file storage. It separates deployed capabilities from evidence that they are operating correctly. A successful build, a healthy sign-in endpoint, or a backup binding is not proof that all production safeguards are working.

## Evidence required before widening the beta

| Area | Evidence required | What the automatic audit can establish |
| --- | --- | --- |
| Administrator security | Account membership requires two-factor authentication; owners, emergency access and token scopes are reviewed | The account API's `settings.enforce_twofactor` boolean, when the existing token has permission. Member/token inventory remains an operator review. |
| Database recovery | Correct production D1 identity, working Time Travel, confirmed plan retention, a usable recovery point | Matching database metadata and a returned Time Travel bookmark. It does not infer the account plan or perform a restore. |
| Original file privacy | The primary bucket's managed public URL and all custom domains are disabled | Both settings are queried independently. |
| Backup privacy and retention | Separate private destination; expiry policy no longer than 30 days; actual complete scans; representative original restored successfully | Destination public-access settings, the configured lifecycle, and the application's full-scan freshness boolean. It does not download real files. |
| Cleanup and maintenance | Cron is deployed, a recent run completed, failed erasure jobs are monitored | Returned Worker schedules and the application's maintenance status. |
| Moderation | At least one valid moderator account is configured and can use the queue | The application's configuration boolean. Secret-name metadata alone proves only that a binding exists, not that it is valid or usable. |
| Diagnostics and alerts | Fixed application diagnostics are retained; reset links and private content are not logged; an external alert reaches the responsible operator | Returned logging settings, including whether automatic invocation logging/tracing are disabled. Alert delivery requires a separate controlled exercise. |

An `unknown` result means the check has not been verified. It is not a pass and does not establish that the setting is insecure. For example, a scoped build token may deploy a Worker without being allowed to inspect account security settings.

## Run the read-only audit

Use the authentication already configured for Cloudflare Workers Builds or an existing authorized Wrangler session. Do not paste an API token, an auth secret, a recovery key, or a provider response into an issue or build command.

```sh
node scripts/verify-cloudflare-operations.mjs --config dist/server/wrangler.json
```

After deployment, an informational build step can use:

```sh
node scripts/verify-cloudflare-operations.mjs --config dist/server/wrangler.json --report-only
```

The generated production configuration selects the deployed Worker and bindings. Before a build exists, `--config wrangler.jsonc` is also supported. The repository configuration currently uses JSON syntax; the script deliberately does not evaluate configuration or load credential files itself.

The default exit codes are 0 when every reported gate is verified, 1 when a returned setting needs attention, and 2 when evidence is incomplete. Several gates deliberately require operator evidence, so an incomplete report is expected until that work is done. `--report-only` preserves every status but returns 0 so that an already completed deployment is not mislabeled as a failed publish. Neither a report-only process exit nor this script alone declares a public beta ready.

The audit uses only these installed Wrangler commands: `whoami --json`, `d1 info DB --json`, `d1 time-travel info DB --json`, `r2 bucket dev-url get`, `r2 bucket domain list`, `r2 bucket lifecycle list`, and `secret list --format json`. Their flags and output formats were checked against the pinned Wrangler source. Secret listing returns names/types, not secret values. R2 output has no JSON flag in this version, so only exact recognized successful status output is accepted.

For metadata that Wrangler does not expose directly, the audit uses an already supplied `CLOUDFLARE_API_TOKEN` in memory. It sends GET requests only to the fixed Cloudflare API origin for account policy, Worker schedules and **`/script-settings`**. This script-only endpoint is different from **`/settings`**, which includes runtime bindings and is deliberately never requested. An OAuth-only local session can still provide Wrangler evidence; API-only checks remain unknown without an existing environment token. The script does not extract OAuth tokens, inspect private Wrangler files, or ask for a broader credential.

The optional public `/api/health?check=operations` endpoint returns capability/freshness booleans without account IDs. A configured backup is assessed separately from a recent complete backup scan. The ordinary `/api/health` contract remains unchanged.

Wrangler diagnostics are captured in bounded memory, disk debug logging and telemetry are disabled, error bodies are discarded, and only selected booleans/statuses are printed. API redirects are rejected and credentials are never sent to the public health endpoint. 403 responses, missing fields, wrong resource identity, partial output and parser failures remain unverified. The audit does not execute SQL, list objects, read auth rows, download user files, export a database, mutate configuration, or restore anything.

## Backup bucket provisioning during deployment

`scripts/ensure-backup-bucket.mjs` is a separate deployment helper; it is not part of the read-only audit. It uses the existing CI API token to ensure that the explicitly configured `BACKUP_BUCKET` exists separately from `BUCKET`. It creates a missing backup bucket only after a definite 404, then verifies its identity, managed public URL, custom domains, retention locks and lifecycle policy. The deployment invokes it before database migrations or replacing the running Worker.

An existing public bucket, an active retention lock, ambiguous account selection, missing permissions or incomplete metadata stops the deployment with a fixed diagnostic. The helper never changes an existing bucket's public-access settings or retention locks, never modifies the primary file bucket, and never prints provider errors or credentials. A failed first-time setup may leave an empty private backup bucket that the next deployment can reuse; it never deletes a bucket as a rollback.

The managed expiry rule is named `cybershelf-backup-expiry-30-days`. An equivalent enabled all-prefix 30-day rule is accepted without renaming it. Otherwise, the helper preserves existing rules and appends the named rule. A conflicting rule under that managed name requires operator review. Cloudflare's lifecycle API replaces the rule collection and does not document conditional update/CAS: the helper rereads before updating to catch observed concurrent edits and verifies all preserved rules afterwards, but administrators and deployments must still serialize lifecycle configuration changes. It does not claim an atomic guarantee against an unobserved edit inside the final request window. [Create bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/) · [Set lifecycle API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/update/)

The helper is tested with injected metadata transports; those tests make no Cloudflare calls. Its success establishes bucket configuration, not that a backup scan has finished or files are recoverable. The separate postdeployment audit and a disposable restore exercise provide that additional evidence.

## Administrator and credential review

In Cloudflare, require two-factor authentication for account membership. Review each member's role, remove unused access, retain a controlled recovery route for the account owner, and review the GitHub repository's owners and deployment access. Record the review date and responsible operator privately. The API policy boolean confirms an account requirement; it does not review the human or token inventory.

Use scoped API tokens for the relevant account, Worker, D1 database and buckets. Keep build/deployment access separate from routine application access. Do not replace an already working `BETTER_AUTH_SECRET` during routine deployment. Treat any credential exposed in a log or issue as compromised and rotate that specific credential through the normal secret flow.

The application should log fixed operational events without usernames, email addresses, filenames, object keys, passwords, session tokens, recovery keys, reading text or provider error bodies. Automatic invocation logs and traces are disabled in this release's configuration to reduce URL capture, including password-reset query parameters. Do not add unsupported redaction fields to Wrangler; confirm actual settings through the safe metadata endpoint after deployment.

## Database and file backup policy

Cloudflare documents D1 Time Travel for the production backend, with 7 days on the Free plan and 30 days on the Paid plan. Confirm the actual plan in the operator account. A current bookmark confirms the API is available; it does not prove that the whole 30-day window is available, that an older desired point still exists, or that recovery has been tested. [D1 recovery reference](https://developers.cloudflare.com/d1/reference/time-travel/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

**D1 recovery does not contain R2 file bytes.** The `assets` table stores each personal original's ID, owner, immutable object key, MIME type and size. `community_assets` independently stores deliberately contributed copies, including their public ID, separate storage ID/key, content hash, consent evidence and approval state. A usable recovery needs eligible records from both tables and their matching file bytes. The `libraries.state` JSON links a book's `sources[].assetId` to its personal file; shared artwork/decor IDs link to `community_assets`. Shelf artwork and public derivatives also need the corresponding files or deliberate regeneration. Curated decorations in `public/decor-catalogue/` are packaged application assets and should be recovered with the matching release.

The optional `BACKUP_BUCKET` is a separate, private destination for original files. See [Original file backups](original-backups.md) for the copier's exact limits and behavior. Its current design reuses the original immutable key, copies active personal files and eligible shared copies, verifies size and available provider checksums, and avoids copying private filename metadata. Pending contributions require an active contributor; approved contributions can outlive their contributor account. Shared erasures, withdrawals and rejections exclude a contribution from copying. Hidden approved artwork can remain privately backed up while its public routes stay unavailable. This is a rolling copy, not object-version history. A daily full scan must finish before health reports it as recent; partial progress never advances complete-scan freshness. New files may wait for the next scan, so the recovery-point gap includes the scan interval and any backlog or failures. Cleanup and backup work use separate five-minute cron invocations, with the backup schedule offset from cleanup.

Configure an all-prefix expiry policy of at most 30 days on the **backup destination only**. Review any bucket lock/retention rules alongside this policy. Active originals are refreshed by subsequent scans; a deleted account's personal originals and pending contributions are no longer eligible for refresh. Approved, explicitly consented shared copies remain eligible as independent records with `contributor_id=NULL` until withdrawn or rejected. Do not put this expiry policy on the primary file bucket. Both buckets must have managed public access and custom-domain access disabled. Disabling only the `r2.dev` URL leaves custom-domain exposure possible. [R2 public access](https://developers.cloudflare.com/r2/buckets/public-buckets/)

R2 lifecycle expiration is asynchronous: Cloudflare says objects are typically removed within 24 hours after expiration and large buckets can take longer. A 30-day rule is therefore an expiry policy, not a promise of deletion at an exact second. Monitor expiry failures/delays and keep the erasure reconciliation window longer than the actual surviving backup history. The current account and community-asset erasure ledgers both last 35 days, covering the documented maximum 30-day database history plus an operational margin. If backups, SQL exports, incident copies or lifecycle delays outlast that window, extend both ledgers' retention **before** extending retention or promoting any older restore. Do not silently retain old private exports indefinitely. [R2 lifecycle behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

Keep SQL exports, backup manifests, credentials preserved for recovery, and incident copies in access-controlled storage with expiry at most 30 days. `account_erasure_ledger` contains an opaque former account ID and request/expiry timestamps; `community_asset_erasures` contains opaque shared-asset/storage IDs and request/expiry timestamps. Both are private and retained for 35 days so later deletions or withdrawals can be re-applied to an older snapshot. Longer retention requires a deliberate coordinated change to the documented policy and both ledgers' retention.

A separate bucket protects against accidental deletion of an original bucket/object. A bucket in the same Cloudflare account does not independently protect against full account compromise or loss. A separately administered encrypted backup destination can address that risk, but is not claimed to be configured by this release.

## Restore procedure

This is an operator procedure for an actual incident or an explicitly scoped rehearsal. The audit never runs it. Do not restore production to test whether backups work.

### 1. Contain writes and preserve the latest security state

Put the application behind an operator-controlled maintenance response before any destructive restore. Pause scheduled writers/copiers and allow active upload work to settle; do not assume changing a cron immediately cancels already running work. Keep authenticated and public content routes closed during reconciliation. Record the selected source, target, current deployed commit, schema version, current Time Travel bookmark, and intended recovery point in a private incident record.

**Before touching the current database, preserve its latest `account_erasure_ledger`, `account_deletion_jobs`, `asset_transfers` and `community_asset_erasures` records.** A historical database's own ledgers can predate recent deletions or withdrawals and cannot be the source of truth. Preserve the complete current `community_assets`, `community_asset_editions` and `community_asset_reviews` records too: approval status, immutable storage identity, explicit consent, edition aliases and a deliberately detached contributor relationship are current decisions, not values to roll back. Also preserve current `auth_user`, `auth_account` and `account_recovery_keys`, `account_suspensions`, `reader_blocks`, `moderation_hidden` (including asset-level rows), and any current publication withdrawal state that will be honored. These exports contain private security data even though stored password/recovery credentials are hashes; encrypt and restrict them and never send them to a build log.

The operator can use reviewed D1 exports to secure files, with the exact selected configuration and table list. Avoid an interactive SQL command that prints credential rows. The production audit intentionally does not do these exports. Verify that the preserved files are readable, complete and outside the resources about to be restored.

If current account security or erasure evidence cannot be recovered reliably, keep login/public routes closed. Do not treat an older password or consumed recovery key as current just because it appears in a backup. This matters for readers who have no email address as well as email accounts. If current shared-asset approval, consent or visibility evidence is incomplete, keep the affected assets unavailable until reviewed; an old approval flag or a surviving R2 object does not establish permission to publish. The local rehearsal conservatively blocks promotion when a historical shared record lacks either a current record or preserved erasure evidence. Resolve these gaps before promotion.

### 2. Restore into an isolated candidate

Prefer a separate disposable D1 database populated from a reviewed SQL export and a separate private R2 destination. Never bind the public Worker to that candidate during the exercise. Apply the correct schema migrations and check foreign keys. Confirm that the selected snapshot is within the supported/retained window.

D1 Time Travel currently performs an in-place database restore; it is not a clone/fork command. If an incident requires it, keep traffic blocked, preserve the latest security/erasure evidence first, record the current recovery bookmark, and have a reviewed rollback plan. Restoring can interrupt in-flight queries. The local rehearsal below exercises the reconciliation logic without invoking this production operation. [Time Travel details](https://developers.cloudflare.com/d1/reference/time-travel/)

### 3. Reapply erasures before restoring files or serving content

Import both separately preserved latest erasure ledgers into the candidate using upserts that never shorten retention. Match shared erasures by asset ID and storage ID; conflicting storage identity is an unresolved recovery error. Union account erasure IDs with pending account-deletion jobs and reconcile every matching account. Do not discard an unexpired deletion or withdrawal merely because its account or asset is absent from the selected snapshot.

For each erased account, remove its library, personal assets, public shelves/profile, journal posts, comments, activity, reads/ratings, followers/follows, blocks, auth sessions/accounts/recovery keys and related moderation data. Delete moderation actions whose report is being erased **before** deleting the report; otherwise `ON DELETE SET NULL` can leave an identifying quoted note behind. Original-file transfer/cleanup obligations and any staged derived images must be handled too. Remove its non-approved shared contributions and record their asset/storage IDs in `community_asset_erasures`. Use the production account deletion implementation as the authoritative inventory when the schema changes.

Approved shared contributions follow their separate, explicitly consented lifecycle. Use the preserved **current** catalogue when deciding this: a copy that was pending in the content snapshot may have been approved before the contributor deleted their account. Restore the approved record, `community-assets-v1` consent evidence, chosen public credit, edition aliases and current review decisions, with `contributor_id=NULL` for an erased contributor. Never restore the old account association or private source upload merely to retain the shared copy. Redact an erased moderator's review relationship/note as the production deletion flow does. Preserve current asset-level `moderation_hidden` rows; a suspended contributor's deletion must leave per-asset hiding behind before the contributor is detached. Retained shared records are the explicit exception to account-content erasure, alongside minimal erasure evidence and unfinished cleanup obligations.

Filter the R2 restore manifest **before** copying objects. It is the union of reconciled, eligible personal `assets` and independent `community_assets` records, not a bucket listing or the backup scan cursor:

| File class | Recovery eligibility |
| --- | --- |
| Personal upload | Owner still exists and appears in neither the account erasure ledger nor pending deletion jobs. |
| Pending shared copy | Contributor survives and has no pending deletion/erasure; no shared erasure exists. Remains private to its permitted owner/moderators. |
| Approved shared copy | Current approval and consent are preserved; no shared erasure exists. It can remain after contributor deletion with a null contributor link. Current hiding/suspension restrictions still apply. |
| Withdrawn, rejected or erased shared copy | Do not restore its bytes, even when the old snapshot says approved or backup storage still contains the object. Current rejected/withdrawn metadata can remain for audit. |

Approved hidden copies may be retained in private storage with their hiding decision intact; file retention does not grant public visibility. Do not restore revoked objects and rely on future cron cleanup to hide them later. The fixture removes ineligible synthetic objects from its staged file map and commits that map only after database reconciliation and integrity checks succeed.

### 4. Preserve current credentials and revoke old sessions

Keep the latest trusted account identity/password/provider/recovery-key state from step 1. Restoring older credentials can re-enable a password that was changed after compromise or a recovery key that was already consumed. Keep immutable user IDs stable while applying current usernames/emails; uniqueness conflicts must be resolved on the isolated candidate, never by temporarily serving ambiguous accounts.

Revoke **all** restored sessions and pending verification/reset tokens. Even a session that was valid at the recovery point may have been signed out or revoked later. Restore current suspensions, reader blocks and moderation hiding, including independent asset hides whose `owner_id` is null. A null contributor must not make hidden artwork public. Do not silently revive withdrawn public shelves or reading posts. The conservative rehearsed path clears restored publication/profile/journal/feed snapshots and requires a fresh reader publication choice after recovery. Clear stale `publicId` values in restored library shelf metadata as part of that visibility reset. If preserving public content instead, reconcile it against a complete current visibility/deletion record before cutover.

For a candidate identity missing from both the current trusted identity snapshot and the erasure evidence, stop and investigate; do not invent a replacement identity or assume deletion. Accounts created after the content snapshot can retain their current identity with an empty/recovered library according to the incident plan.

### 5. Restore and verify files

For every retained personal file source, check the full relationship: library `sources[].assetId` → `assets.id` and owner → `assets.object_key` → the restored original's bytes. For shared artwork/decor, check the stable shared ID → current `community_assets` record → immutable storage ID/key → exact copied bytes, plus edition aliases where applicable. Verify size and the stored SHA-256 `content_hash` for contributed copies. Check cryptographic checksums for other originals where available; never assume an R2 ETag is an MD5 checksum, especially for multipart objects. A missing or mismatched original is an unresolved recovery failure, not a successful restore. Current approvals created after the content snapshot may need files from a newer recovery copy; preserve their metadata and keep them unavailable until those bytes are verified. Recover personal shelf image references and published derivatives under their ownership rules.

Use a representative test EPUB/PDF, personal image and contributed image in the isolated environment. Confirm the surviving reader can retrieve their personal original, a different reader cannot, erased readers have no auth/library/public records or restored private originals, and old session/reset credentials fail. Confirm an approved detached shared copy remains available to permitted readers without restoring the contributor account, pending-erased/withdrawn/rejected copies have no restored bytes, and hidden/suspended assets stay unavailable through catalogue and image routes. Check both primary and destination public-access settings again.

### 6. Promote only after all checks pass

Run database integrity/foreign-key checks and the application's authentication, account deletion, upload and visibility smoke tests against the isolated candidate. Record the selected backup timestamps, missing-file findings, checksum results and deletion reconciliation result without recording private book content or credentials.

Before reopening production, take a fresh copy of any security/erasure events accepted since step 1, including shared withdrawals/rejections, approvals, contributor detachments and moderation visibility changes; if writes were fully paused this should be empty. Reconcile both ledgers and current asset state again, then recheck the file manifest and public visibility. Confirm the intended Worker bindings, private buckets, maintenance schedule, moderator availability and logs. Re-enable scheduled maintenance and only then restore traffic. Readers must sign in again. Monitor errors, cleanup backlog and backup completion during the first scan.

Remove temporary restore copies on schedule and retain only a minimal incident record. Do not leave a publicly reachable staging Worker or a second unexpired copy of users' private books behind.

## Disposable local restore rehearsal

```sh
node --test --test-reporter=spec --experimental-test-isolation=none tests/operations.test.mjs
```

The rehearsal applies the actual committed SQL migrations to disposable SQLite, writes real synthetic backups, changes a surviving reader's password/recovery key, deletes another reader, and then restores the older databases into temporary copies. It imports both latest erasure ledgers and pending deletion obligations, removes erased private data/files, preserves current account security, revokes old sessions/reset tokens, clears public snapshots, and verifies the surviving library's original bytes with SHA-256.

Its shared-asset scenario withdraws and rejects copies after backup, approves a previously pending contribution before deleting its contributor, erases another pending contribution, hides artwork through moderation, and deletes a suspended contributor. Recovery preserves consented approved copies, detached account relationships, edition aliases, review decisions and asset-level hides while excluding revoked bytes and the erased reader's private source. Missing current asset evidence blocks promotion; a checksum mismatch rolls back database and staged-file changes together. Repeated reconciliation verifies idempotence and retained erasure windows, and stale writes cannot recreate erased private records. Fixture files are removed afterwards; no Cloudflare credentials, application users or production objects are used.

The parser/transport tests also cover denied permissions, wrong database identity, public custom domains, incomplete lifecycle rules, ambiguous account selection, provider error suppression, bounded responses and token isolation from public health requests.

Passing this test verifies the local recovery procedure and schema behavior. It **does not** verify that production backups exist, that the live plan has 30-day Time Travel, that real files were copied, or that a Cloudflare restore has succeeded. A separately scoped disposable Cloudflare rehearsal with synthetic assets and recorded evidence is still needed before claiming those properties.

## Alerts and ongoing review

The shipped **Production health** GitHub Actions workflow checks `/api/health?check=operations` every 15 minutes without credentials. Enable failed-workflow notifications and run its `simulate_failure` delivery drill, then verify that the responsible operator actually receives it. Scheduled GitHub runs can be delayed or disabled; for stronger coverage, configure a separate external uptime monitor at a five-minute interval. The source-controlled workflow alone does not prove notification delivery. Alert the designated operator on repeated failures, maintenance older than 15 minutes, a stalled complete backup scan, failed cleanup backlog, or loss of moderator configuration. Alert on abnormal Worker/D1/R2 failure rates and billing/quota thresholds through the provider where available. Do not put a reader's file name, book, username or credential in an alert payload.

The responsible operator must configure and verify the destination, trigger a controlled synthetic failure and confirm receipt. A configured policy or a successful log write is not proof of delivery. The read-only audit never sends an email/message or asserts delivery from configuration alone.

Review failed erasure jobs promptly; durable retries prevent a transient bucket outage from restoring access, but retries must continue running. Review backup freshness and storage growth daily during beta, and repeat an isolated restore rehearsal after schema, auth, storage or backup changes. Keep the alert destination, moderator coverage, retention policy and administrative access review owned by a named operator.

## Primary references

- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 limits and plan retention](https://developers.cloudflare.com/d1/platform/limits/)
- [R2 Wrangler commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)
- [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 object lifecycle behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Cloudflare account settings and two-factor policy](https://developers.cloudflare.com/api/resources/accounts/methods/get/)
- [Worker schedules API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)
- [Worker script-only settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/)

GitHub references: [Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications) and [workflow run notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

The operations endpoint also reports `maintenanceStarted`. A false value means no durable housekeeping claim has been recorded; after a first-run failure it is true while `cleanupHealthy` is false. `maintenanceRecent` becomes true only after a completed run. Allow Cloudflare's documented cron propagation window before treating a never-started schedule as a fault; never treat a configured schedule alone as successful cleanup.
