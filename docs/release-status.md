# Release status — 0.4.0

Updated 2026-10-22.

## Source and destination

The public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository remains the source for the existing Cloudflare Worker at `https://cybershelf.io`. Version 0.4 adds per-book Reading together rooms and a browser-authorized Hardcover connector. The direct shelf controls, `||\` icon, and `cybershe\f` wordmark remain in place.

The existing Worker, D1 database, R2 bucket, domain, and authentication secret are reused. Migration `0005_reading_rooms` adds the shared-book index; the deploy command applies pending migrations before publishing and stops if one fails. There are now six migrations. Catalog state remains schema version 1, with optional connection records and backward-compatible backups.

**Hardcover requires one-time owner activation.** Its code and configuration screen are included, but the repository does not contain a registered `HARDCOVER_CLIENT_ID`. Until the owner registers a public single-page OAuth application and sets that runtime variable, the UI truthfully reports authorization as unavailable. See [account connections](account-connections.md) for exact settings. No additional Cloudflare storage resource is required.

## Source verification

- Full TypeScript validation passed.
- **107 regression cases passed**, with no failures, skips, or cancellations.
- The production Vinext build passed, including the reading-room API, Connections, and OAuth callback page.
- Wrangler’s deployment dry run passed without publishing or applying remote migrations. It retained the existing DB/BUCKET bindings and domain configuration.
- All six migrations applied to disposable D1 storage.
- The built Worker passed integration checks with temporary accounts, ephemeral D1/R2, real signed sessions, and outbound network access disabled.
- Source publication excludes dependencies, build output, temporary databases, and secrets. Dependency versions and the lockfile are unchanged.

New regression coverage checks provider mapping and scopes, PKCE state/account/issuer validation, expired and replayed callbacks, memory-only credentials, pagination without partial imports, response-size limits, refresh rotation, and cancellation. Merge checks cover manual edits, equivalent ISBNs, distinct editions, complete bookmark pairs, rereads, progress preference changes, idempotent retries, atomic limit rejection, non-destructive disconnects, field allowlists, and connection backup round trips.

The real-Worker room suite checks Unicode-aware legacy indexing, selected-copy bookmark ceilings, absence of future post/reply bodies from responses, safe reply markers, progress moving forward and backward, both pagination orders, self/follow membership, profile revocation, and parent reshares. Configuration access respects authenticated account boundaries, and the callback is uncached and sends no referrer. Existing authentication, private originals, shelves, profiles, journals, feed, moderation, publication revocation, and rate-limit checks still pass.

## Provider and browser verification limits

Hardcover’s live public discovery document, scope metadata, and browser CORS preflights were verified without credentials. The OAuth protocol and mapping tests use controlled provider responses. A real-user authorization round trip remains unverified until the owner registers the public client ID; discovery checks do not establish that end-to-end consent passed.

The managed local preview supervisor is unavailable in this workspace. Local visual and responsive browser QA could not run before publication. Build/API checks do not replace a browser/device review. Any live desktop checks belong in the deployment report; on-device iPhone testing remains separate.

A source push and dry run do not prove that Cloudflare’s production build or domain deployment completed. Check the Workers Builds result for the pushed commit and the actual domain. The integration suite uses no production account data.

## Product boundaries

- Reading rooms include only the reader’s and followed readers’ explicitly shared entries. The room API withholds later text. Shared posts remain public writing; the existing public thread/feed routes retain their own deliberate-reveal controls.
- Protection depends on reader-supplied markers and conservative normalized title/author matching. Percentages across editions are approximate; incorrectly marked text can still spoil a story.
- Hardcover sync reads into Cybershelf and runs while the authorized browser tab is visible. Reloading or closing the page discards tokens. It is not bidirectional or unattended synchronization.
- Reading progress sync is opt-in. Local edits win conflicts, and remote removals never delete local books, shelves, files, or journal entries. A provider’s ownership flag is not a verified purchase.
- Provider tokens are not sent to Cybershelf or saved in backups. Imported library metadata is stored by Cybershelf and remains accessible to its operator. This release does not provide end-to-end encryption or protection against changed future website code.
- Goodreads remains CSV import. Retailer locations remain saved links. Automatic retailer purchases, universal reader progress sync, DRM removal, OPDS, and a full EPUB reader are not included.
- Private library changes do not broadcast activity. Thoughts, shelf snapshots, and acquisition announcements are shared deliberately. The feeds refresh in-app; email/push delivery is not included.
- Book sizes are labelled estimates, catalog values, or manual measurements. Shelf settling is deterministic geometry with animation, and the visual arrangement does not guarantee a physical fit.
- Basic email/password accounts retain their existing limitations: email delivery and forgotten-password recovery are not configured.
- Backups include connection preferences/provenance and private reading history, but not provider credentials, social identities, follows, or sharing permissions. Cross-account file restoration still requires reconnecting uploaded originals.

See the [README](../README.md), [changelog](../CHANGELOG.md), [architecture](architecture.md), [account setup](account-connections.md), and [Cloudflare guide](self-hosting.md).
