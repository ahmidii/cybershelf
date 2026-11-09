# Release status — 0.8.0 public-beta candidate

Updated 2026-11-09. Package version: `0.8.0`.

## Current status

**This release has passed local acceptance; broader public-beta promotion still requires production evidence.** It includes username accounts and recovery keys together with account deletion, reporting, blocking, moderation, atomic upload reservations, and production recovery/maintenance tooling. The build, regression, built-Worker and migration checks below passed. Confirm the serving deployment and complete the operational gates before describing the service as ready for wider public use.

The initial 0.8.0 release was deployed from commit `7f35e164501c568d09a02ae1f1d4a7fb916b3999`: Cloudflare Workers Builds reported success and the live health endpoint returned release 0.8.0 with accounts and email configured. The home, username-only signup and privacy pages were observed working. A complete original-file backup scan was observed in production on 2026-11-09. The monitoring follow-up makes first-run cleanup failures visible and exposes whether maintenance has started; its own build check confirms publication. These deployment signals do not establish email inbox delivery or administrator security.

## Authentication update

Better Auth and `@better-auth/drizzle-adapter` are now pinned to **1.7.16** in the source and lockfile. The maintainer explicitly approved exact-version exceptions for the required authentication package family, resolving the earlier release-age block. The general seven-day dependency policy remains enabled; it was not globally disabled.

The acceptance results below are from the complete expanded 0.8.0 source with Better Auth 1.7.16, including the final cleanup-progress and monitoring corrections. They supersede the earlier username-only candidate checks.

## Candidate scope

- Username/password signup without required email, one-time recovery-key display and rotation, existing email-account compatibility, and stronger new-password controls.
- Fresh-session/current-password account deletion with explicit confirmation. Authentication, live private/public records, and linked reports/audit data are removed atomically; durable R2 cleanup survives storage failures. A minimal 35-day erasure ledger supports recovery reconciliation.
- Canonical public reports, bounded explanations, duplicate/rate controls, reciprocal blocks, and authenticated-view filtering across profiles, shelves, reading updates, replies, feeds, reading rooms, and image routes.
- An immutable-account-ID moderator allowlist, review queue, fresh-session actions, decision history, content hide/restore, and participation suspension/restore. Suspension preserves private export, account security, and deletion access.
- Atomic upload byte/count reservations, in-flight limits, bounded multipart processing, account-state checks at finalization, and retryable cleanup. Empty cancellation barriers protect against unresolved late writes.
- Optional private original/artwork backup copies, bounded maintenance, safe operational status/audit tooling, and an isolated restore procedure that preserves current credentials and applies current erasure evidence before reopening service.

The additive migrations are `0007_username_accounts` and `0008_public_beta_safety`. The existing Worker, account secret, database, primary file bucket, domain, and email configuration are intended to be preserved. The optional backup destination requires its own private binding and retention setup; source configuration is not proof of provisioning.

## Verification record for this expanded candidate

| Check | Current record |
| --- | --- |
| TypeScript and production build | Passed on 2026-11-09 for the expanded release. |
| Regression and account UI tests | 201 passed, zero failed, zero skipped, on 2026-11-09. |
| Built-Worker integration and all migrations | Passed on 2026-11-09, including healthy multi-batch deletion progress and failed standalone removal monitoring. Disposable D1/R2 and intercepted-mail fixtures cover all nine migrations, account recovery, deletion, moderation/blocks, upload races/failures, actual scheduled handlers and original-file copying/recovery. |
| Isolated restore rehearsal | Passed using disposable SQLite plus synthetic originals: current credentials and erasures survive rollback; old sessions/reset tokens and public snapshots are removed. Separate D1/R2 recovery fixtures verify original bytes. Live Cloudflare restore remains unverified. |
| Browser and physical-device behavior | Live home, username-only signup and privacy pages checked after the initial release. Managed local preview is unavailable because its daemon mailbox is missing. No physical iPhone/iPad verification is claimed. |
| Production deployment | Initial 0.8.0 deployment confirmed from the successful Cloudflare check and live release response. Verify subsequent monitoring commits from their own Cloudflare checks and health response. |
| Cloudflare administration and storage audit | Incomplete. The attempted dashboard sign-in returned HTTP 403; inaccessible settings remain unverified. |
| Real moderator setup and review coverage | Pending a verified Cybershelf account ID and assigned reviewer. There is no automatic first-user promotion. |
| Production backup/restore and alert delivery | First complete production original-file scan observed; live isolated restore and notification delivery remain unverified. Local synthetic restoration passed. |

No independent penetration test or blanket security certification is claimed. The repository's automated tests use synthetic fixtures and disposable storage; they are not authorization to inspect real libraries, send account email, or exercise production moderation/deletion.

## Gates before wider public promotion

Configure actual moderator IDs in the Worker's runtime `MODERATOR_USER_IDS`, verify queue access and ordinary-account denial, assign report review responsibility, and publish a private support contact. The queue accepts reports independently of whether an operator has completed this setup, so a working report form does not establish moderation coverage.

Verify administrator MFA and access/token scope, both buckets' managed URLs and custom domains, the intended D1 recovery point and actual plan retention, deployed maintenance, complete backup freshness, and delivery of operational alerts. Perform the restore procedure in isolated resources with synthetic originals before claiming that database-and-file recovery is tested. Unknown settings remain unknown until evidence is obtained.

The recovery-copy policy is at most 30 days, with storage-expiry processing lag. The minimal erasure ledger lasts 35 days and must cover all surviving backup history. Restores must apply the latest trusted account-security state and current erasure evidence, revoke restored sessions/reset tokens, and honor moderation/publication restrictions before serving content. Do not promote an old backup whose own ledger predates recent deletions.

## Retained boundaries

Username accounts provide pseudonymity; they do not make the service completely anonymous or end-to-end encrypted. Private library metadata and files remain readable by the service operator. Public content remains accessible when signed out even if a signed-in reader is blocked. Reports are private to configured moderators but are not end-to-end encrypted.

Shared ratings/reads come from explicit contributions and public completion posts. Private library changes are not broadcast. Goodreads uses CSV import; Hardcover requires provider authorization and keeps credentials in browser memory. Amazon synchronization, DRM removal, automatic retailer activity, OPDS, and an in-browser EPUB reader remain outside this release. There are no automatic moderation-decision emails or social push notifications.

For setup and limitations, see [beta readiness](beta-readiness.md), [production operations](production-operations.md), [original file backups](original-backups.md), [moderation](moderation.md), [upload storage](upload-storage.md), [self-hosting](self-hosting.md), and the [changelog](../CHANGELOG.md).
