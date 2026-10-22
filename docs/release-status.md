# Release status — 0.1.1

Updated 2026-10-22.

## Source and destination

The application source is published in the public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository. This update adds a standalone Cloudflare deployment and real email/password accounts to the first release. GitHub remains the source of future updates.

The committed configuration targets Worker `cybershelf`, D1 `cybershelf-db` with the maintainer-provided database UUID, private R2 `cybershelf-files`, and `https://cybershelf.io`. A source push does not by itself verify that a Cloudflare deployment or the custom domain is live. Follow [self-hosting](self-hosting.md) for the build settings, D1 token permission, and runtime authentication secret.

## Verified for this update

- TypeScript validation completed successfully.
- The regression suite passed: **27 tests, no failures or skipped tests**.
- The production Vinext build completed successfully, including the new sign-in page and authentication API route.
- The generated Worker configuration contains the expected real database/bucket bindings, canonical origin, and custom-domain route.
- Wrangler's deployment dry run passed without applying remote migrations or publishing.
- Both committed SQL migrations applied to disposable local D1 storage; repeating the migration command correctly reported no pending migrations.
- The production Worker bundle passed a one-shot integration check in workerd with ephemeral D1/R2 and external network access disabled.
- Source files were checked for accidental credential patterns and local runtime files. Dependencies, local databases, generated builds, and secret files are excluded from source publication.

The Worker integration check exercised guest and sign-in page rendering, two real accounts, correct and incorrect passwords, signed HTTP-only/SameSite/Secure session cookies, unverified email handling, cross-origin authentication rejection, forged-header rejection, stale-account preconditions, private original uploads/downloads, account isolation, save-version conflicts, public snapshot redaction, public-image revocation, sign-out, revoked-session rejection, and concurrent database-backed rate limiting. It also verified that D1 stores salted password hashes and rate-limit counters.

The application regression suite covers Goodreads CSV parsing, original-file attachment, import/export round trips, ZIP byte preservation, shelf-arrangement invariants, strict state validation, public/private field separation, safe sign-in redirects, and fail-closed authentication configuration.

## Verification still pending

Browser-based visual, responsive, and keyboard-interaction QA remains incomplete because the preview browser was unavailable. Successful server rendering does not establish that visual QA passed.

The local runtime checks do not prove deployed DNS, TLS, Cloudflare token permissions, runtime secret configuration, or production CPU usage. After deployment, verify account creation, sign-in, a persisted shelf, an original-file download, and a signed-out public share link at the actual custom domain.

## Account and product boundaries

Basic accounts use email and password. Email delivery, email verification, and forgotten-password recovery are not configured in this release. Automatic account linking is disabled. The signup screen states the recovery limitation. Legacy caller-supplied identity headers are not authentication.

Goodreads support remains CSV import; retailer sources remain saved links. There is no automatic purchase sync, cross-reader progress sync, DRM removal, OPDS endpoint, or full EPUB reader. Reviews and reading journal data are private. ZIP export includes original uploads, but full cross-account ZIP restore is not implemented as a single operation.

See the [README](../README.md), [changelog](../CHANGELOG.md), and [Cloudflare setup guide](self-hosting.md).
