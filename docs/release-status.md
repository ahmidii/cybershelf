# Release status — 0.2.0

Updated 2026-10-22.

## Source and destination

The public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository remains the source for the existing Cloudflare Worker at `https://cybershelf.io`. Version 0.2 adds physical book proportions and settling, featured profiles, progress-stamped journals, public reading conversations, and a Following feed.

The existing Worker, D1 database, R2 bucket, domain, and authentication secret are reused. Migrations `0002_featured_profiles`, `0003_reading_journal`, and `0004_feeds` add the social tables. The deploy command applies pending migrations before publishing the Worker; it stops if a migration fails. Existing catalog state remains schema version 1, with optional new fields and support for older backups.

## Verification

- TypeScript validation passed with all new routes and client components.
- **65 regression tests passed**, with no failures, skips, or cancellations. The runner reports individual test cases.
- The production Vinext build passed, including `/u/[id]`, `/j/[id]`, and the new social API routes.
- Wrangler’s deployment dry run passed without publishing or applying remote migrations; the generated Worker configuration retains the expected DB/BUCKET bindings and custom domain.
- All five migrations applied to disposable D1 storage.
- The built Worker passed end-to-end API integration checks with temporary accounts, ephemeral D1/R2, real signed sessions, and outbound network access disabled.
- Source publication excludes dependencies, build output, temporary databases, and secrets. Dependency versions and the lockfile are unchanged.

Regression coverage includes legacy import/export behaviour, JSON/CSV reading-log round trips, private spine backups, ISBN metadata parsing, geometry contact/collision checks, dimension bounds, fixed historical reading markers, and public field allowlists. Render tests verify that unread/ahead-of-progress prose is absent from the DOM, while explicit reveal preferences and safe markers allow it to render.

The Worker suite exercises account isolation, stale-account headers, optimistic save conflicts, concurrent publication/removal, profile snapshots independent of Explore, private edits remaining private, source/file redaction, public-image retention and revocation, journal sharing/unsharing, reply moderation, persistent posting limits, effective reply markers after a parent update, feed/announcement pagination, explicit acquisition sharing, follows across profile privacy changes, session revocation, and authentication rate limiting.

## Visual verification

The managed local preview supervisor was unavailable in this workspace, so local browser-based visual, responsive, and keyboard-interaction QA could not be completed. Production build, API, geometry, and markup checks do not establish that a full browser/device review passed.

A source push and local dry run do not by themselves prove that Cloudflare’s production build or domain deployment completed. Check the latest Workers Builds deployment for the pushed commit and open the actual domain after deployment. No real account data is used by the integration tests.

## Product boundaries

- Book dimensions are labelled estimates, catalog values, or manual measurements. Generated spines are a visual fallback; optional uploaded art can supply an actual spine. Shelves scale to the available display and do not guarantee a real-world fit.
- Settling is deterministic constrained geometry with animation, not a general physics simulation.
- Existing reviews, notes, ordinary progress changes, and private shelf creation stay private. Journal entries and acquisition announcements are shared explicitly.
- Spoiler protection follows reader-supplied markers and conservative title/author matching. Percentage comparisons across editions are approximate, and incorrectly marked text can still spoil a story.
- The feed is an in-app stream with refresh-on-focus/visibility and periodic refresh while visible. Email and push notifications are not included.
- Goodreads support remains CSV import. Retailer sources are saved links; purchases and reader progress do not synchronize automatically. Original EPUB/PDF uploads can be retrieved, but DRM removal, OPDS, and a full EPUB reader are not included.
- Basic accounts retain the existing email/password flow. Email delivery and forgotten-password recovery are not configured; the signup screen explains this.
- Catalog backups include private reading history and physical shelf metadata. They do not transfer social identities, follows, public conversations, or sharing permissions. Cross-account ZIP restoration still requires reconnecting uploaded originals.

See the [README](../README.md), [changelog](../CHANGELOG.md), [architecture](architecture.md), and [Cloudflare setup guide](self-hosting.md).
