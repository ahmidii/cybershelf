# Changelog

## 0.1.1 — Standalone Cloudflare deployment — 2026-10-22

### Added

- Cloudflare configuration for `cybershelf.io`, the maintainer’s existing D1 database, and private R2 bucket.
- A deploy command that applies pending database migrations before publishing the built Worker; dry runs do not mutate remote resources.
- Email/password account creation, sign-in, POST sign-out, signed database-backed sessions, and persistent authentication rate limiting.
- A dedicated responsive sign-in page and an honest setup state when the authentication secret is missing.
- Local setup that generates an ignored development secret and uses the same real account flow as production.
- Authentication regression coverage and disposable Worker integration checks using session cookies.

### Changed

- Private APIs use authenticated account sessions and no longer trust hosting-specific identity headers.
- Private writes check the expected account as well as library versions to prevent stale tabs saving across an account switch.
- Deployment documentation now covers Workers Builds, migrations, secret configuration, and the custom domain.

### Account boundary

- No email delivery, email verification, or password-reset flow is configured yet. Account linking is disabled. The sign-up screen states this limitation.

## 0.1.0 — First edition — 2026-10-21

### Added

- Ownership-neutral Library with manual entries, metadata search, Goodreads CSV import, and EPUB/PDF uploads.
- Several named shelves with Open, Cubby, and Tower structures; Balanced, Gallery, and Stacks layouts; and four finishes.
- Book placement, facing, pinning, sorting previews, cancel/apply, undo, duplication, and a staging tray for overflow.
- Built-in SVG plants, bears, robots, vases, and bookends, plus private image uploads for personal decoration.
- Book source links and physical locations, with authenticated download of original uploaded files.
- A private reading journal with manual progress, ratings, reviews, and notes.
- Explicit publication snapshots, shared shelf pages, Explore, saving a shared title, and copying a shelf's arrangement and built-in objects.
- Account persistence in D1, private object storage in R2, and optimistic save-version conflicts.
- Catalog JSON, reading CSV, and ZIP exports containing original uploads and an asset manifest.
- A labelled sample library, browser-local guest drafts, responsive shelf controls, and alternatives to dragging.
- Regression tests for import handling, safe backups, arrangement preservation, validation, and private/public access boundaries.

### Release boundaries

- Goodreads import is one-way CSV import. Retailer accounts and reading progress do not synchronize automatically.
- Reading uses an original-file download or the saved platform link. A full EPUB reader and OPDS are future work.
- Reviews and journal records remain private. Public pages show the chosen shelf snapshot.
- Physical shelf planning is visual and does not calculate fit from dimensions.
- JSON restores catalog data; ZIP files must currently be unpacked and original uploads reconnected manually when moving to another account or deployment.
- The original 0.1.0 required a separate authentication adapter for independent hosting; 0.1.1 supplies that adapter and Cloudflare deployment configuration.
