# Upload quotas and deletion cleanup

The public-beta upload protocol keeps a durable D1 record before an object can be written to R2. This covers newly initiated uploads after the deployment containing this protocol.

## Storage accounting

An account can hold at most 500 MiB or 1,000 files, with at most four upload reservations active at once. A single conditional D1 statement checks committed assets plus reservations and pending cleanup, then reserves the new file's bytes and count. Concurrent requests cannot each spend the same remaining allowance.

Finalization inserts the asset record and removes its reservation in one D1 batch. The statement rechecks that the account exists, has no deletion job or active suspension, and still owns a valid, unexpired reservation. A storage failure preserves the reservation or turns it into a cleanup obligation; it never silently frees quota while original bytes may remain in the bucket.

Deleting an unreferenced file atomically queues its cleanup before removing the asset record. Its private URL stops working immediately. Pending erasure still counts against quota until storage confirms deletion. Public shelf/profile/journal image references and a private-library version check prevent ordinary file removal from deleting an image that is still in use.

## Request limits

- Book originals remain limited to 25 MiB; artwork remains limited to 4 MiB.
- Multipart input is bounded to 26 MiB, including its overhead, and has a 120-second read deadline. A slow or cancelled body is stopped without keeping the parser occupied indefinitely.
- One multipart parse/full-file buffer runs per Worker isolate, with at most four waiting requests and a 15-second queue wait. This avoids holding several large full-file buffers within a Worker's memory limit.
- Upload attempts are limited durably before body parsing: 30 per minute / 300 per hour per account and 90 per minute / 900 per hour per source address. Counter keys are HMAC digests rather than raw account identifiers or IP addresses.
- Reservations expire after ten minutes. A scheduled, bounded retry handles expired transfers and failed cleanup. Retry delays back off to at most one hour.

These are abuse and resource bounds, not a guarantee against distributed account creation or every form of application abuse. Production alerts and spending controls remain necessary.

## Why an empty cancellation marker can remain

Each upload uses a new opaque random object key and a conditional R2 write (`If-None-Match: *`). A completed write can be deleted normally. For an unconfirmed or still-running write, cleanup replaces its key with an **empty object with no original metadata**. A late conditional write then fails, so it cannot recreate the original book or image after an account has been deleted.

After storage confirms the barrier, its D1 transfer record is removed. The remaining zero-byte object contains no book/image bytes, filename, title, email address, or account identifier. It is an operational cancellation marker, not a recoverable upload, and its random key is never returned by a live asset record. Some markers may remain indefinitely when a writer's completion cannot be established. Do not remove these markers using a blanket timed lifecycle rule while an old writer might still exist; removing the barrier would re-open the write condition.

R2's documented conditional writes and strong consistency underpin this behavior: [Cloudflare R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).

## Account deletion and maintenance

Account deletion moves committed asset keys into `asset_transfers` with a confirmed-writer flag and marks existing reservations for cleanup. Auth and public/private account records can then be removed in the same database transaction without losing the object keys needed for erasure. `cleanupAssetTransfers({ DB, BUCKET }, { ownerId?, limit? })` processes bounded work. Failed cleanup remains in the table, without file content, for a later retry. The account deletion job remains pending until the account's transfer records have cleared.

The helper logs only fixed operational failure messages. It does not print filenames, file contents, credentials, account names, or object keys. Operations monitoring should watch for repeated `cybershelf asset cleanup deferred` and `cybershelf upload cleanup deferred` events, along with growing pending-job counts, and investigate the underlying binding, permission, or storage availability issue.

## First-rollout limitation

The previous upload implementation did not record an object's key durably before writing its bytes. An upload already executing that old version during deployment cannot be retroactively put under the new reservation protocol. Its existing fallback tries to remove a file if database finalization fails, but a simultaneous failure of that fallback could leave an untracked old object.

Use a controlled rollout boundary and verify that older upload requests have drained before relying on the new deletion guarantees for all requests. If an old storage failure is suspected, perform a reviewed, private R2 inventory reconciliation against both committed assets and pending transfers after that drain. Do not blindly delete every object absent from a catalog export: exports omit unreferenced uploads, private metadata is not a complete bucket inventory, and cancellation markers have a separate purpose. A historical orphan sweep has not been performed by these source changes.
