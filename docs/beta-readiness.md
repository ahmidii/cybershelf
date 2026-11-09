# Public-beta readiness assessment

Updated 2026-11-09 for the local **0.8.0 candidate**. This document separates implemented controls, candidate verification, and evidence about the live installation. It is a source assessment, not an independent penetration test or a security guarantee.

## Decision

The requested account deletion, reporting/blocking, moderation workflow, and atomic upload reservations are implemented in this candidate. Better Auth and its adapter have been updated to 1.7.16 using the maintainer-approved exact-version release-age exceptions. The seven-day policy remains enabled for other dependency releases.

**The expanded candidate is not yet signed off for a broad public beta.** Its expanded build, 201 regression cases, and local recovery checks have passed. The built-Worker acceptance record and production deployment must be checked against this release commit; production gates below remain separate from local verification. See [release status](release-status.md) for the current record.

The intended next step is to finish verification, deploy the reviewed candidate through the existing Worker, complete the operational checks with synthetic data, and then invite a supported beta cohort. Wider promotion should follow recorded evidence. Registration is open unless the operator adds an access restriction; inviting a small group is a rollout decision, not a technical invitation gate.

## Implemented account and privacy boundaries

- Passwords are salted hashes. New or changed passwords use versioned native scrypt with fixed parameters, random salts, constant-time comparisons, and a bounded derivation queue. Existing hashes and shorter legacy passwords remain usable until changed. Predictability checks are limited and do not constitute a complete breached-password database.
- Sessions are database-backed. HTTPS cookies use Secure, HttpOnly, and SameSite attributes. Caller-supplied identity headers cannot authenticate a request; the expected-account header prevents a stale tab from mutating a different signed-in account.
- Sensitive account operations require the current password and a recent sign-in. Recovery replaces the credential and recovery key, revokes sessions, and invalidates pending email-reset credentials. Durable attempt limits and conditional writes protect competing requests.
- Recovery keys contain 256 random bits and are stored only as digests. The usable key is shown when created or replaced. The app does not place it in a URL, email it, or include it in a library export.
- Private library and file routes enforce ownership. Public shelves/profiles/reading updates use deliberately published snapshots. Original EPUB/PDF files never become public image assets.
- HTML rejects framing, and sensitive responses use no-store, no-referrer, and nosniff controls. This does not provide a complete script-restricting Content Security Policy or a guarantee against every browser attack.

The implementation sources are [authentication](../lib/server/auth.ts), [passwords](../lib/server/passwords.ts), [username accounts](../lib/server/username-accounts.ts), and [account deletion](../lib/server/account-deletion.ts). Final execution against the updated dependency tree is required before release.

## Requested beta controls

| Area | Implemented in this candidate | Evidence still required before widening |
| --- | --- | --- |
| Account deletion | A fresh-session/current-password flow removes auth and associated live D1 records atomically, revokes public routes, queues original/artwork erasure, and retries storage failures. A minimal erasure ledger supports recovery reconciliation. | Passing final integration checks; live maintenance running; observed synthetic cleanup and backlog monitoring. |
| Reporting and blocking | Canonical public targets, bounded reports, durable attempt/duplicate controls, reciprocal blocks, and server-side feed/conversation/image filtering. | Real moderator account IDs configured, review coverage assigned, private support contact published, and an ordinary-account access-denial check. |
| Moderation | An immutable-ID allowlist, recent-sign-in actions, recorded decisions, public hide/restore, and participation suspension/restore. Suspended users retain private export, security, and deletion. | A responsible person can access the deployed queue and understands escalation, restoration, and data handling. The queue is not a staffed service by itself. |
| Upload limits | A single D1 reservation protects byte/count/in-flight limits. Finalization rechecks account state; pending cleanup counts toward quota. Conditional writes and cancellation barriers address unfinished uploads. | Passing concurrency/failure tests and observed production retry behavior. Older requests must drain at rollout; historical untracked objects are not retroactively reconciled by this protocol. |
| Production operations | Read-only audit tooling, bounded maintenance, optional private original-file backup support, status reporting, and an erasure-aware restore runbook. | Actual administrator/MFA review, private primary/backup buckets, Time Travel coverage, a completed file backup, an isolated Cloudflare restore exercise, and delivered alerts. |

The [moderation guide](moderation.md), [upload protocol](upload-storage.md), [production runbook](production-operations.md), and [original-file backup guide](original-backups.md) describe the exact behavior and setup.

## Production evidence is still pending

The attempted Cloudflare dashboard sign-in returned HTTP 403. That result did not establish administrator security, bucket exposure, current retention, or alert configuration. An unavailable setting is **unverified**, not automatically insecure. Existing authorized read-only tools can collect additional evidence without broadening credentials or exposing private records.

Record these checks before a broad public invitation:

1. Require administrator MFA and review account members, repository/deploy access, recovery access, and token scopes.
2. Confirm the primary file bucket and separate backup bucket both have managed public access and custom domains disabled.
3. Verify the intended D1 database, a usable Time Travel bookmark, and the actual plan's recovery window. Do not infer 30-day coverage from a working API call.
4. Configure the private backup destination and retention policy; confirm a full successful scan. A binding or recent partial scan is insufficient.
5. Rehearse restoration in isolated resources with synthetic originals and current security/erasure reconciliation. Verify bytes and owner isolation before describing the backup as tested.
6. Verify deployed maintenance schedules and recent successful runs. Assign an operator to failed erasure jobs, stale backups, provider errors, and spending thresholds.
7. Configure an external alert destination and confirm receipt of a controlled synthetic failure. The application does not infer delivery from logging configuration.
8. Configure `MODERATOR_USER_IDS` from verified Cybershelf account IDs copied at `/safety`. There is no first-user bootstrap and no username/email-based promotion.

A normal health response reports account/email configuration readiness. The optional operations health response reports limited capability/freshness booleans. Neither response certifies administrator MFA, delivered email/alerts, or a successful production restore.

## What no required email means

A new reader chooses a username and password without providing a real name, email address, or retailer login. The authentication schema uses a random non-deliverable internal address where its adapter requires one; it is not a contact address. Existing email accounts retain their existing email sign-in and configured recovery paths. Adding or removing email is not part of this release.

This provides **pseudonymity, not complete anonymity**. The service and hosting infrastructure process account identifiers, sessions, network information, libraries, and shared activity. Private stored data is protected by authorization and remains readable by the service operator; it is not end-to-end encrypted. Reused names, uploaded images, and public posts can identify a reader. External artwork hosts receive requests from readers' browsers.

For an account without email, losing both the password and recovery key leaves no supported recovery path. Screenshots, public profile details, and a support conversation do not prove ownership. Never request a password or recovery key in a public issue or support message.

## Deletion, recovery copies, and restoration

Deletion acceptance removes live access and associated records together. Uploaded originals and artwork may take longer to erase during a storage outage; the durable job continues without the user staying on the page. Unknown in-flight writes are sealed with empty, metadata-free cancellation objects. Those markers have no usable book/image bytes or live account mapping. Do not remove them using the backup bucket's expiry policy.

Reports, captured excerpts, and linked audit text are erased when their reporter or target account is deleted. They otherwise have no automatic application retention deadline in this release. Shared book titles/authors are ownerless bibliographic records and can remain. Other people's saved copies cannot be recalled.

The operator recovery policy limits private recovery copies, SQL exports, and incident copies to **30 days**. Storage expiration can finish after the configured date; the policy is not a claim of exact-second physical erasure. The private erasure ledger holds only an opaque former account ID and request/expiry timestamps for **35 days**. Its window must exceed the actual surviving backup history. Delayed lifecycle expiration or longer incident retention requires coordinated action before an older restore can be promoted.

Before any restore, preserve the latest trusted account credentials/recovery-key state and the current erasure ledger outside the database being replaced. Apply current deletions and moderation restrictions, revoke restored sessions/reset tokens, and honor publication withdrawals before serving traffic or restoring file access. An old backup's own ledger can predate a deletion; old credentials can re-enable a changed password or consumed recovery key. If trustworthy current security/erasure evidence is unavailable, keep the restored service closed until the recovery plan is resolved.

The periodic file copier is separate from D1 recovery and can lag new uploads by the scan interval plus processing delays. Complete-scan freshness does not make database records and file bytes an atomic snapshot. Reconcile the retained asset manifest and verify each needed original during recovery. A local synthetic drill verifies code paths; it does not prove that live backups exist or that a Cloudflare restore has succeeded.

## Remaining product limits

| Area | Current boundary |
| --- | --- |
| Image privacy | Ordinary uploads can retain camera/location metadata; cropped spine exports are re-encoded. External cover/spine/decoration hosts receive browser requests. |
| Blocking and spoilers | Public content remains public while signed out. Spoiler controls follow declared markers, not semantic analysis of text. |
| Authentication choices | No user passkeys or app MFA, and no comprehensive compromised-password screening. Administrator MFA is a separate operator requirement. |
| Moderation communications | No automatic decision email, block notification, or staffed appeals service is provided. Operators need an appropriate private contact. |
| Device verification | Automated checks do not establish physical iPhone/iPad gesture, camera, password-manager, or assistive-technology behavior. These need representative device checks. |
| Backup scope | Reader JSON/CSV/ZIP exports do not recreate all social records or serving permissions. Periodic operator originals are recovery copies, not a file-version history or independent protection against total Cloudflare-account compromise. |

## Rollout handoff

Preserve the existing authentication secret and production resource identities. Apply the additive migrations through the existing reviewed deployment path, and retain the general dependency-aging policy with only the approved exact-version exceptions. Record the actual deployed commit, final test results, migration outcome, and operational checks in [release status](release-status.md).

Start with readers who understand recovery keys and explicit sharing, monitor authentication resource usage and cleanup/backup backlog, and collect reproducible bugs without private credentials or book files. Expand when the evidence supports it, rather than treating a successful build as the final beta-readiness gate.
