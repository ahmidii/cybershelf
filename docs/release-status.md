# Release status — 0.3.0

Updated 2026-10-22.

## Source and destination

The public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository remains the source for the existing Cloudflare Worker at `https://cybershelf.io`. Version 0.3 replaces numbered destinations with direct placement along each shelf, a live settled preview, wheel/touch/keyboard pose controls, and undo. The identity now uses a `||\` icon and `cybershe\f` wordmark.

The existing Worker, D1 database, R2 bucket, domain, and authentication secret are reused. This release needs no new database migration. Existing catalog state remains schema version 1; optional row/position/support fields preserve compatibility with older backups. The deploy command still applies any pending migrations before publishing the Worker and stops if a migration fails.

## Verification

- TypeScript validation passed for the complete application.
- **84 regression tests passed**, with no failures, skips, or cancellations. The runner reports individual test cases.
- The production Vinext build passed, including the updated shelf canvas and the existing profile, journal, and social routes.
- Wrangler’s deployment dry run passed without publishing or applying remote migrations; the generated Worker configuration retains the expected DB/BUCKET bindings and custom domain.
- All five migrations applied to disposable D1 storage.
- The built Worker passed end-to-end API integration checks with temporary accounts, ephemeral D1/R2, real signed sessions, and outbound network access disabled.
- Source publication excludes dependencies, build output, temporary databases, and secrets. Dependency versions and the lockfile are unchanged.

New regression coverage includes arbitrary continuous positions, gallery rows with more than four books, insertion without swapping, inferred piles, removing bottom/middle supports, wall/pile leaning, blocked full destinations, legacy arrangement migration, exact preview/committed geometry equality, and collision bounds across all bookcases. Data checks cover coordinate bounds, support graphs, copying/removing piles, sorting roles, and backup round trips. Existing book metadata, reading-log, public-field, and spoiler-render checks still pass.

The built Worker suite verifies exact private PUT/GET persistence of continuous coordinates and stack supports, rejects stale or invalid saves without changing the saved state, and checks the same placements in public shelf and featured-profile snapshots. It also exercises account isolation, stale-account headers, optimistic save conflicts, concurrent publication/removal, profile snapshots independent of Explore, private edits remaining private, source/file redaction, public-image retention and revocation, journal sharing/unsharing, reply moderation, persistent posting limits, effective reply markers after a parent update, feed/announcement pagination, explicit acquisition sharing, follows across profile privacy changes, session revocation, and authentication rate limiting.

## Visual verification

The managed local preview supervisor was unavailable in this workspace, so local browser-based visual, responsive, and gesture QA could not be completed before publication. Production build, API, geometry, and markup checks do not establish that a full browser/device review passed. Live desktop checks belong in the deployment report; on-device iPhone gesture testing remains a separate check.

A source push and local dry run do not by themselves prove that Cloudflare’s production build or domain deployment completed. Check the latest Workers Builds deployment for the pushed commit and open the actual domain after deployment. No real account data is used by the integration tests.

## Product boundaries

- Book dimensions are labelled estimates, catalog values, or manual measurements. Generated spines are a visual fallback; optional uploaded art can supply an actual spine. Shelves scale to the available display and do not guarantee a real-world fit.
- Settling is deterministic constrained geometry with animation, not a general physics simulation.
- Shelf positions are continuous within physical rows and compartments. A destination without enough room is rejected visibly; the original placement remains intact. Pose controls offer six choices instead of unrestricted rotation. Touch dragging starts on a book or decoration; blank shelf areas retain page scrolling.
- Existing reviews, notes, ordinary progress changes, and private shelf creation stay private. Journal entries and acquisition announcements are shared explicitly.
- Spoiler protection follows reader-supplied markers and conservative title/author matching. Percentage comparisons across editions are approximate, and incorrectly marked text can still spoil a story.
- The feed is an in-app stream with refresh-on-focus/visibility and periodic refresh while visible. Email and push notifications are not included.
- Goodreads support remains CSV import. Retailer sources are saved links; purchases and reader progress do not synchronize automatically. Original EPUB/PDF uploads can be retrieved, but DRM removal, OPDS, and a full EPUB reader are not included.
- Basic accounts retain the existing email/password flow. Email delivery and forgotten-password recovery are not configured; the signup screen explains this.
- Catalog backups include private reading history and physical shelf metadata. They do not transfer social identities, follows, public conversations, or sharing permissions. Cross-account ZIP restoration still requires reconnecting uploaded originals.

See the [README](../README.md), [changelog](../CHANGELOG.md), [architecture](architecture.md), and [Cloudflare setup guide](self-hosting.md).
