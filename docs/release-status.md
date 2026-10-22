# Release status — 0.5.0

Updated 2026-10-22.

## Source and destination

The public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository remains the source for the existing Cloudflare Worker at `https://cybershelf.io`. Version 0.5 adds public book and edition pages, explicit community ratings/completed reads, and one unified Reading together destination. The direct shelf controls, `||\` icon, and `cybershe\f` wordmark remain in place.

The existing Worker, D1 database, R2 bucket, domain, and authentication secret are reused. Migration `0006_book_community` adds minimal community book records, explicit contribution tables, and the public-post work index. The deploy command applies pending migrations before publishing and stops if one fails. There are now seven migrations. Catalog state remains schema version 1; optional work/edition identities remain compatible with existing libraries and backups.

No new Cloudflare resource or secret is required. Hardcover retains its previous one-time owner activation requirement: the repository does not contain a registered `HARDCOVER_CLIENT_ID`, and authorization remains unavailable until it is configured. Goodreads remains CSV import. No Amazon connector was added.

## Source verification

- Full TypeScript validation passed.
- **119 regression cases passed**, with no failures, skips, or cancellations and a verified terminal test summary. The runner now rejects an apparently successful process that ends without a complete summary.
- The production Vinext build passed, including the public book routes and unified reading view.
- All seven migrations applied to disposable D1 storage.
- The built Worker passed integration checks with temporary accounts, ephemeral D1/R2, real signed sessions, and outbound network access disabled.
- The public catalog renders from the built Worker, and unknown community book URLs return an actual HTTP 404.
- Source publication excludes dependencies, build output, temporary databases, and secrets. Dependency versions and the lockfile are unchanged.

Catalog regressions cover canonical work/edition IDs, edition-specific metadata, pagination, caching and deduplication, exact matching, ISBN verification, ambiguous/truncated result refusal, author fallback, host and redirect restrictions, bounded streamed responses, malformed responses, and existing dimension-lookup compatibility. Identity tests cover persistence, backup/CSV round trips, public field allowlists, and preserving distinct editions.

The new real-Worker community suite checks title/author-only manual registration, private data exclusion, account/stale-tab boundaries, rating aggregation, duplicate and concurrent completed-read submissions, removable contributions, database limits, canonical cross-edition completion posts, unsharing/profile revocation, and account deletion cascades. Existing authentication, private originals, shelves, profiles, journals, following feed, moderation, and server-side spoiler filtering still pass.

Targeted UI render and identity checks verify one reading composer, selected-book private-history isolation, exclusion of private text from the circle, accurate edition matching, and public-page rendering without browser globals or invented statistics. A matching request is invalidated when its title/author/ISBN changes, and the final library update checks the expected metadata again. ISBN edits clear the old identity; Book details provides an explicit rematching action.

## Provider and browser verification limits

Open Library work, edition, search, and ISBN response shapes were checked against its public endpoints. Protocol/edge-case regression checks use controlled upstream responses. Catalog metadata remains externally maintained and may be incomplete or temporarily unavailable. The courtesy queue is per Worker isolate, not a distributed global rate limiter.

The managed local preview supervisor is unavailable in this workspace. Build/API checks do not replace visual or on-device review. Live desktop checks and the hosting build result are reported after the source push; on-device iPhone testing remains separate.

A source push does not itself prove that Cloudflare's production build or domain deployment completed. Check Workers Builds for the pushed commit and the actual domain. The integration suite uses no production account data.

## Product boundaries

- Book-page statistics come from explicit community ratings/read logs and live, explicitly shared completion posts. Private library ratings, status, imports, notes, files, and unshared thoughts never contribute silently.
- Each reader has one community rating per work. Completed-read totals take that reader's dated read count, or one if they have a live 100% shared post and no dated reads. Different dates can represent rereads; repeated final thoughts do not multiply the count.
- Unsharing a completion post or unpublishing its profile removes its journal-derived contribution. Explicit community ratings and dated reads have separate removal controls. Catalog backups do not recreate those public contributions.
- Open Library works group known editions. Older posts without a reliable work identity are not guessed into a work's totals; exact manual title/author fallback stays separate. Available editions and metadata depend on catalog coverage.
- Reading together includes one composer and Your circle / Your journal views. The circle API withholds later text; protection follows declared markers and conservative matching, with approximate percentages across editions. Incorrectly marked text can still spoil a story.
- Hardcover reads into Cybershelf while the authorized tab is visible; progress import is opt-in. Local edits win conflicts and remote removals do not delete local books. Reloading or closing the page discards credentials.
- Provider tokens are not sent to Cybershelf or saved in backups. Imported library metadata remains accessible to the service operator; this is not end-to-end encryption or protection against changed future website code.
- Goodreads remains CSV import. Retailer locations remain saved links. Automatic retailer purchases, universal reader progress sync, DRM removal, OPDS, and a full EPUB reader are not included.
- Private library changes do not broadcast activity. Thoughts, shelf snapshots, and acquisition announcements are shared deliberately. Email/push delivery is not included.
- Book sizes remain labelled estimates, catalog values, or manual measurements. Shelf settling uses deterministic geometry and animation; the preview does not guarantee a physical fit.
- Basic email/password accounts retain their existing limitations: email delivery and forgotten-password recovery are not configured.

See the [README](../README.md), [changelog](../CHANGELOG.md), [architecture](architecture.md), [account setup](account-connections.md), and [Cloudflare guide](self-hosting.md).
