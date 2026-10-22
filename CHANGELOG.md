# Changelog

## 0.3.0 — Direct shelf placement — 2026-10-22

### Changed

- Replaced numbered placement cells with continuous positions along each shelf. Dragging works directly in the private shelf view, without opening shelf options first.
- Added a live landing ghost using the same deterministic solver as the final drop, with neighboring books making room, supported leaning, and horizontal piles.
- Added mouse-wheel pose cycling during a drag, visible touch-friendly pose controls, tap-to-place, keyboard movement, cancellation, and one-step undo.
- Removed the manual pin and numbered-position controls. Direct movement also releases a retained legacy pin.
- Books and decorations can be dragged back from the staging tray. Adding a new object searches for physical space instead of an empty numbered slot.
- Continuous coordinates and stack relationships survive saved libraries, backups, public shelf/profile snapshots, shelf duplication, and copied arrangements. Old arrangements and backups remain supported; no database migration is needed.
- Added the `||\` icon and favicon, with `cybershe\f` as the wordmark.
- Preserved intervening moves when a decoration upload finishes, pruned deleted books from undo history, and cleared stale previews/history when replacing or reloading a catalog.
- Reserved scrolling space above the floating pose controls so the final shelf row and its actions remain reachable.
- Kept pointer capture on the staging tray throughout a drag and suppressed native browser dragging, matching the direct shelf controls.


## 0.2.0 — Shelves with character, reading with company — 2026-10-22

### Added

- Proportional book heights and spine widths from editable millimetre measurements, format/page-count estimates, or matched ISBN edition metadata.
- Tight spine packing, true horizontal book piles, supported leaning against walls/books/piles/bookends, and reduced-motion-aware settling transitions.
- Optional spine artwork with authenticated image uploads and generated title/colour fallbacks.
- One featured shelf per profile, a private preview, explicit public profile snapshots, and public reader pages.
- Page/percentage-stamped private reading logs, progress-only milestones, body editing, explicit entry sharing, and unsharing.
- Public reading threads with progress-marked replies, owner moderation, per-entry links, and public profile journals with per-book reading order.
- Following public profiles and a chronological feed of shared reading updates, replies, published shelves, and explicit purchased/added book announcements.
- Spoiler controls based on the viewer’s saved progress, unread-book protection, local progress overrides in reading conversations, and deliberate individual reveal. Hidden prose is absent from the accessible DOM.
- D1 migrations for profiles, journal posts/comments, persistent posting counters, follows, and book activity. Existing libraries remain compatible.
- Regression and disposable Worker integration coverage for geometry, reading logs, public image access, social privacy, revocation, rate limits, and account boundaries.

### Changed

- Replaced typed ASCII branding with an outlined two-book mark and consistent readable typography.
- Shelf controls expose facing and lean choices, dimensions, and a featured-shelf shortcut while preserving drag, tap, and keyboard placement.
- JSON/CSV/ZIP backups preserve new book appearance and private journal data; old backups remain accepted.
- Saving a library and revoking removed shelf/profile/journal publications now happen together in a database transaction.

### Sharing boundaries

- Existing notes/reviews and ordinary progress changes are not automatically published. Each journal entry and purchase/addition announcement is shared intentionally.
- A private shelf creates no feed activity; publishing or updating its public snapshot does.
- Unpublishing a profile hides its linked journal/feed activity. A newly published profile does not resurrect old reading posts or comments automatically.
- Spoiler markers are reader-supplied, with approximate percentage comparisons across editions. They cannot detect incorrectly marked spoilers.
- There is no automatic purchase/progress synchronization, email/push notification delivery, full physics engine, or physical fit guarantee in this release.

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
