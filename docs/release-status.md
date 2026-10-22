# Release status — 0.6.0

Updated 2026-10-22.

## Source and destination

The public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository remains the source for the existing Cloudflare Worker at `https://cybershelf.io`. Version 0.6 completes the account interface and recovery implementation, repairs missing runtime authentication configuration during deployment, and improves the transition from a guest draft to a saved account.

The existing Worker, D1 database, private R2 bucket, and domain are reused. No dependency or schema migration is added; all seven existing migrations remain. Public book/edition pages, Reading together, shelf placement, the `||\` icon, and `cybershe\f` wordmark are retained.

## Account behavior

- Email/password signup and sign-in use signed HTTP-only cookies, salted password hashes, D1 sessions, and persistent authentication rate limits.
- Account & security shows the current private email identity and actual verification state. It supports password changes using the current password and signing out other devices.
- Older sessions can explicitly sign in again for sensitive changes. A stale tab cannot apply account mutations to a different signed-in reader.
- Browser drafts can be adopted only by an untouched account collection. The signup name is preserved, customized bookless shelves are protected, and the exact imported local draft is removed only after a successful save.
- Failed saves offer export or an explicit discard-and-sign-out action. Concurrent save callers serialize before choosing a revision.
- Auth, account, and recovery pages have no-store, no-referrer, and noindex protections. Reset tokens are removed from the visible URL after the page captures them in memory.

## Deployment configuration

The deploy command applies pending migrations before uploading the built Worker and preserves optional runtime settings. It then checks the existing secret names and the public account capability endpoint. An encrypted authentication key or an already-working legacy runtime key is preserved. A missing key uses a valid build-only value if supplied, otherwise 48 random bytes; the value goes through stdin into Cloudflare's encrypted secret binding, without process arguments, output, or debug files.

The final read-only status check verifies that the running application sees usable account configuration. It does not create a production account or establish that email reaches an inbox. First-time initialization should run as one deployment, because the list-then-put operation is not an atomic create-only API. Invalid existing credentials are not silently rotated.

## Email activation boundary

Forgotten-password recovery and confirmation are implemented behind two optional runtime settings: encrypted `RESEND_API_KEY` and `AUTH_EMAIL_FROM` from a verified sending domain. The owner must configure the provider and complete an inbox test for their own account. See [the setup guide](self-hosting.md#6-enable-account-email).

Without those settings, basic accounts remain usable and the UI explicitly explains that email recovery is not enabled. `email: true` in `/api/health` means syntactic configuration readiness, not a provider/domain/delivery guarantee. Existing accounts are not suddenly required to verify to sign in.

When enabled, signup queues confirmation email through the Worker lifetime. Confirmation links expire after 24 hours and do not create or switch a session. Password reset links expire after one hour, are single-use, and revoke all existing sessions on success. Reset request responses do not disclose whether an account exists, including when the provider rejects delivery. The transport uses a fixed provider endpoint and generic operational error messages; recipients, links, tokens, and provider payloads stay out of logs.

## Verification

Release validation includes TypeScript, the full regression suite with a verified completion summary, the production Vinext build, and the built Worker using disposable D1/R2 storage. The account lifecycle tests intercept email in memory and keep all real outbound traffic disabled.

Verified for this source release: TypeScript passed; **135 regression cases passed** with no failures, skips, or cancellations and a complete terminal summary; the production build passed; all seven migrations applied to disposable D1; and the full real-Worker integration suite, including account recovery and session revocation, passed. The mail transport was tested in Workerd itself after correcting its supported manual-redirect behavior.

The account checks cover signup/signin, secure cookies, private state and file ownership, stale-tab rejection, email configuration, callback confinement, one-time/expired reset credentials, password policy, old-password rejection, session revocation, actual email verification, password changes, and recovery rate limits. Deployment regressions cover missing-only secret initialization, preserving existing keys, stdin-only transport, invalid configuration, and redaction of provider errors. Guest-draft regressions cover identity preservation, nonempty account safeguards, and exact-value cleanup after save.

Existing shelf, catalog/edition, community statistics, journal, following-feed, and server-side spoiler protection tests remain release gates. No production reader data or real emails are used by the integration suite.

A source push alone does not establish that Cloudflare finished deployment. Confirm the Workers Builds result for the pushed commit, the live sign-in interface, and `/api/health`. Production inbox delivery requires the separate owner activation above. The managed local browser-preview supervisor is unavailable in this workspace; real iPhone interaction remains a separate on-device check.

## Retained product boundaries

- Book statistics come from explicit community contributions and live, deliberately shared completion posts; private library records never contribute silently.
- Thoughts remain private until shared. Reading-room spoiler protection follows declared markers and conservative book matching, with approximate percentages across editions.
- Hardcover still requires its own public client ID and provider authorization. Credentials stay in browser memory; imported library metadata is server-stored, not end-to-end encrypted.
- Goodreads remains CSV import. Amazon account synchronization, DRM removal, automatic retailer activity, OPDS, and an in-browser EPUB reader are not included.
- Email-address changes and automatic account linking remain disabled. Confirmation/recovery messages are distinct from social-feed notification email, which is not implemented.

See the [README](../README.md), [changelog](../CHANGELOG.md), [architecture](architecture.md), [book-account connections](account-connections.md), and [Cloudflare guide](self-hosting.md).
