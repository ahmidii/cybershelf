# Release status — 0.8.0 beta candidate

Updated 2026-11-09.

## Candidate and deployment hold

The 0.8.0-beta.1 source prepares username/password accounts without a required real email address, recovery keys, stronger new-password handling, and clearer privacy information. Existing email logins remain supported. It adds one migration, `0007_username_accounts`, for a nullable unique username and recovery/rate-limit records; it does not replace existing accounts, libraries, resource bindings, or secrets.

**This candidate is not deployed.** The existing production baseline remains 0.7.0, commit `3f8614061dc21a58cf57a4b39d957814cf65d68d`. A read-only check on 2026-11-09 returned HTTP 200 from `/signin` and `/api/health`, with `accounts: true` and `email: true`. Those capability flags are not a security certification or an end-to-end test of delivery to a real inbox.

Better Auth's [November 3 security release](https://better-auth.com/blog/security-release-2026-11-03) recommends stable 1.7.16. The attempted update was blocked by the repository's seven-day minimum dependency release age. Installed dependencies and the lockfile remain at 1.7.8. The policy has not been bypassed. Either wait until the required releases have aged, or approve exact-version exceptions for the security update; then install and repeat the build and account checks before deployment. The latest blocked release matures around 2026-11-10 21:25 UTC.

Checks against the existing installed 1.7.8 package do not establish compatibility with the pending 1.7.16 update. The managed preview daemon is unavailable in this workspace, so no new browser or physical-device verification is claimed for this candidate.

### Candidate verification — 2026-11-09

- TypeScript passed, and the production Worker build completed.
- 181 regression cases passed with a complete terminal summary, no failures, skips, or cancellations. These include password-format compatibility, username/key validation, and seven real-React account/privacy rendering tests.
- All eight migrations applied to disposable D1. The full built-Worker suite passed with local D1/R2 and an intercepted email transport; it did not use production data or send external email.
- The Worker checks covered existing email signup/verification/reset/change flows, private account and asset isolation, stale-account tabs, native session cookies and persistent limits, username normalization and concurrent signup, suppression of email for username accounts, fresh-password/fresh-session requirements, recovery-key rotation and replay refusal, exactly one winner for concurrent recovery, revocation of all sessions and pending email-reset credentials, and preservation of legacy 12-character passwords and private data.
- A simulated key-storage failure verified that a partially created account remains usable and directs the reader to sign in and finish recovery setup. The simulation uses a disposable local database trigger only.
- Native Workerd password probes passed new and legacy hash verification, concurrent request contexts, and bounded queue overload. These are local behavior and wall-time checks, not proof of the production plan's billed CPU allowance.
- A combined integration run caught an email-verification redirect regression in the new response wrapper. The wrapper was corrected to leave redirects untouched, rebuilt, and the complete suite then passed. No affected build was deployed.
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `wrangler.jsonc`, the production main branch, and existing secrets were unchanged during verification.

No independent penetration test, dashboard configuration audit, production restore drill, or new physical-device gesture test was performed. The native preview daemon's missing mailbox prevented browser interaction testing in this workspace.

See [beta readiness](beta-readiness.md) for the rollout recommendation, privacy boundaries, and remaining account deletion, abuse response, upload quota, and operational work.

## Previous deployed release — 0.7.0

Updated 2026-10-23.

## Source and destination

The public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository remains the source for the existing Cloudflare Worker at `https://cybershelf.io`. Version 0.7 improves page-based reading updates, phone and tablet shelf controls, and adding authentic spine artwork to a selected copy.

The existing Worker, D1 database, private R2 bucket, domain, and account/email configuration are reused. No dependency or database migration is added; all seven existing migrations remain. The deployment continues to preserve runtime settings. The `||\` icon and `cybershe\f` wordmark are unchanged.

## Reading progress

- Book details, Reading together, and journal composition default to a page number. Percentage is calculated from the selected edition's total pages. An unknown total is requested once and saved with that copy.
- Percentage entry remains an explicit alternative for reading apps. A reader never has to enter both a page and an approximate percentage for one update.
- Exact bookmarks use an optional `currentPage` field without changing `schemaVersion: 1`. JSON and CSV backups preserve it. Older percentage-only records remain valid and use conservative page suggestions.
- Stored fractions and spoiler thresholds retain full precision. Display rounding never marks a book complete before the actual end. A thought written without moving the bookmark preserves the previous ceiling.
- Page-count corrections reconcile a compatible exact bookmark. A total below that page clears the incompatible page rather than declaring the book finished. Historical journal markers are not rewritten.
- Public journal and conversation view controls use the viewer's own edition count. An explicit, validated **Use this place** action changes only the local view. Reply markers default to **This thought**, with optional bookmark or later-page choices.

## Touch shelves

Browsing swipes scroll over the shelf. **Arrange shelf** enables direct finger dragging and release-to-place, with a live settled-position ghost. Larger pose controls offer Auto, Spine, Cover, Stack, and either lean. A second finger can change the pose during a drag; the one-handed alternative is **Pick up**, tap a destination, choose a pose, then **Place here**.

Fine-position arrows move along a row or between rows. Cancel restores the prior arrangement. The bottom palette has measured clearance so lower rows remain reachable; a finger released over the palette retains the last valid preview. Desktop wheel cycling and keyboard controls retain their existing handlers. Hybrid devices detect the pointer actually used.

## Authentic spine artwork

Book details now shows the spine preview directly, identifying authentic saved artwork versus the typographic fallback. **Choose photo** and **Take photo** open a browser crop editor with drag, zoom, width, rotation, and keyboard controls. The original stays in browser memory. Only the cropped JPEG goes through the existing authenticated image-upload route.

The image follows the copy through upright, leaning, and stacked placements. Generated text and decorative marks disappear after the real image loads. Failed images fall back to typography. Upload completion is guarded against account or edition changes. Replacing an established edition clears its old spine and exact page; equivalent ISBN-10/ISBN-13 forms preserve the copy.

Automatic authentic-spine retrieval is not included. The documented [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers) and [Google Books volume image links](https://developers.google.com/books/docs/v1/reference/volumes) provide covers/image sizes without a reliable spine-image field. Readers supply a real photo or an upright image link. Artwork is not guessed and presented as an exact edition match.

## Verification

Verified for this source release:

- TypeScript passed.
- **161 regression tests passed**, with a complete terminal summary and no failures, skips, or cancellations.
- The production Vinext build passed.
- All seven migrations applied to disposable D1, and the full built-Worker integration suite passed with temporary D1/R2 storage.
- Worker checks include precise page round trips, private spine references, explicitly published spine assets, publication redaction/revocation, account isolation, reading-room spoiler ceilings, community statistics, and the existing account lifecycle.
- Account email tests intercept messages in memory with external requests disabled. No real emails, production accounts, or reader data are used.

The managed local browser-preview supervisor is unavailable in this workspace. Physical iPhone/iPad gestures and camera/crop behavior remain on-device verification items; automated results do not establish that every touch browser behaves identically.

A source push alone does not establish that Cloudflare finished deployment. Confirm the Workers Builds result for the pushed commit and the live site. Account email continues to use the owner's existing settings; `/api/health` reports configuration readiness rather than guaranteeing provider delivery. See [the email setup guide](self-hosting.md#6-enable-account-email) when self-hosting.

## Retained product boundaries

- Book statistics come from explicit community contributions and deliberately shared completion posts. Private library records never contribute silently.
- Thoughts remain private until shared. Spoiler controls follow declared markers; page fractions across different editions remain approximate.
- Hardcover requires its own public client ID and provider authorization. Credentials stay in browser memory; imported metadata is server-stored, not end-to-end encrypted. Goodreads remains CSV import.
- Amazon synchronization, DRM removal, automatic retailer activity, OPDS, and an in-browser EPUB reader are not included.
- Account confirmation/recovery email is separate from social-feed notification email, which is not implemented.

See the [README](../README.md), [changelog](../CHANGELOG.md), [architecture](architecture.md), [book-account connections](account-connections.md), and [Cloudflare guide](self-hosting.md).
