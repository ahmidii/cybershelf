# Release status — 0.9.1 shared artwork

Updated 2026-11-10. Package version: `0.9.1`.

## Scope and current evidence

This release adds a searchable set of 100 Kenney/KayKit decorations and a shared contribution system for decorations, book spines, and covers. Community metadata and independent image copies persist in D1/R2, with explicit permission, review, edition matching, credits, withdrawal, and recovery reconciliation. It retains the account, reading, shelf, and safety features from 0.8.0.

Local release acceptance passed on 2026-11-10: TypeScript, the production build, all 239 regression cases, the complete built-Worker integration suite, and the nine-case operations rehearsal. Image-orientation hardening is included in those final checks. Confirm the serving deployment from the release commit's Cloudflare check and the live health response; local acceptance alone does not establish publication.

The additive migration is `0009_shared_assets`. The integration suite applies all ten migrations to disposable storage. The existing GitHub-to-Cloudflare workflow applies pending migrations before publishing. This update does not migrate hosting, replace authentication secrets, alter account email setup, or add runtime dependencies. Better Auth and its adapter remain pinned to 1.7.16 under the already approved exact-version dependency-age exceptions.

The first 0.9.0 Cloudflare build succeeded and the live health endpoint reported every existing capability/operations flag as healthy. Live UI inspection then found that the isolated test harness had supplied an `ASSETS` binding missing from production configuration, and that grid rows compressed under their height limit. Version 0.9.1 explicitly configures the binding, makes the harness read it from the built configuration, checks full/thumbnail MIME and bytes, and gives picker rows their natural content height.

## What is ready in the source

- A transparent, searchable starter catalogue with 100 CC0 decorations, categories, public source/license details, resizing, flipping, and direct shelf placement.
- Shared decorations, covers, and spines with private pending uploads, explicit permission, independent copies, contributor management, moderator review, reports, and withdrawal.
- Verified edition/ISBN matching, equivalent ISBN-10/13 handling, alternate-printing choices, automatic matching spines, and protection of existing personal artwork.
- Saved shared identities across private libraries, published shelves/profiles, copied arrangements, and supported exports. Images are served through revocable routes with public metadata allowlists.
- Existing atomic quotas extended to contributed copies; bounded image processing and submission limits; account deletion that erases private/pending copies and detaches explicitly retained approved contributions.
- Backup scan coverage for approved retained copies and a restore procedure that imports current asset consent/visibility and both erasure ledgers before recovering files or reopening service.
- Original creator license files, exact source provenance, image/model/archive hashes, and a reproducible offline rendering script.

The curated catalogue works without an external search key. A third-party web search is not part of this release. Pending community submissions become generally available only after a configured moderator approves them. Uploading an image or publishing a shelf does not automatically contribute that image.

## Verification record

| Check | Record |
| --- | --- |
| TypeScript and production build | Passed on 2026-11-10 with final image-orientation hardening. |
| Regression and account UI tests | 239 passed, zero failed and zero skipped, on 2026-11-10. |
| Built-Worker integration | Passed with all ten migrations, isolated D1/R2 and intercepted external fixtures. Includes actual cross-account contribution/reuse, curated image routes, verified editions, privacy, moderation, withdrawal, reviewer/account deletion, and backup copy behavior. Repeated successfully against the final production bundle and sanitizer. |
| Isolated restore rehearsal | Nine operations cases passed, including withdrawn/rejected artwork, retained approved copies after contributor deletion, current hiding/suspension, missing evidence, checksum rollback, and idempotent reconciliation. No live restore was performed. |
| Visual catalogue review | All 100 rendered objects inspected in contact sheets; transparency and output dimensions checked. Twenty-four real JPEG/PNG/WebP orientation samples independently decoded with identical display results. |
| Browser and physical-device behavior | Managed local preview is unavailable because its preview relay is missing. Initial live 0.9.0 verification found a missing production static-asset binding and compressed picker rows. Version 0.9.1 corrects both; verify the final interface after deployment. No physical iPhone/iPad verification is claimed. |
| Production publication | Confirm the release commit's Cloudflare check and live release response. |
| Moderator runtime configuration | The live 0.8.0 health endpoint reported moderation configured on 2026-11-10 before this update. Actual reviewer access and staffing are separate operational checks; no account is automatically promoted. |
| Administrator security, recovery and alerts | Existing operational gates remain unverified where no production evidence was obtained. |

Tests use synthetic accounts and disposable storage. No production library, user upload, account deletion, report, or real recipient is part of these fixtures. No independent penetration test or blanket security certification is claimed.

## Operator steps

Configure `MODERATOR_USER_IDS` in the existing Worker's runtime variables with the immutable Cybershelf account IDs of actual reviewers. Readers can copy their account ID from **Account & security → Safety & blocked readers → Account identifier**. Confirm the configured reviewer can open `/moderation` and an ordinary account cannot. Assign review coverage and publish a private support contact. Approval requires a recent sign-in and a note; self-approval is refused.

The live 0.8.0 health response was checked immediately before this update on 2026-11-10. It reported accounts, email, moderation configuration, maintenance configuration/start/freshness, cleanup health, backup configuration, and backup freshness as true. A complete original-file backup scan had also been observed on 2026-11-09. Those observations do not verify administrator MFA, scoped tokens, every storage access path, actual reviewer access/staffing, restore performance, or alert delivery. The earlier dashboard sign-in attempt returned HTTP 403; inaccessible settings remain unverified.

Before broader promotion, verify administrator MFA/access, primary and backup bucket privacy, actual D1 retention, deployed maintenance, complete backup freshness, and operational alert delivery. Perform the restore procedure in isolated resources before claiming production database-and-file recovery is tested.

Recovery copies and SQL/incident exports have an operator policy of at most 30 days, with storage expiry processing lag. Account and shared-asset erasure ledgers last 35 days and must cover all surviving backup history. Restore current account-security state, current shared catalogue/consent/status, both erasure ledgers, and current moderation restrictions before serving anything. Revoke old sessions/reset tokens. A historical file or an old approval is not sufficient evidence to republish withdrawn artwork.

## Retained boundaries

Username accounts are pseudonymous; service operators can read stored private metadata and files. Public material remains accessible when signed out even when a signed-in reader is blocked. Contributions deliberately choose a public creator credit. Approved contributions may remain after account deletion under their explicit permission, with the account relationship removed; withdraw them first if their shared copies should be erased as well. Private and unapproved uploads are erased with the account.

Shared artwork coverage depends on actual contributions and verified edition metadata. The starter decorations are display miniatures, not real product measurements. Goodreads remains CSV import, Hardcover requires provider authorization, and Amazon synchronization, DRM removal, retailer activity, OPDS, and an in-browser EPUB reader remain outside scope. No automatic moderation-decision email or social push notification is added.

See [shared artwork](shared-assets.md), [asset sources](decor-asset-sources.md), [production operations](production-operations.md), [original backups](original-backups.md), [moderation](moderation.md), [upload storage](upload-storage.md), and the [changelog](../CHANGELOG.md).
