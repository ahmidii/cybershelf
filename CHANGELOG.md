# Changelog

## 0.6.0 — Your account, everywhere — 2026-10-22

### Added

- A private Account & security page with email identity, actual verification status, current-password changes, and signing out other devices.
- Email confirmation and one-hour, single-use password reset flows, activated by a verified Resend sender. Existing sessions are revoked on reset; confirmation never signs in or switches accounts automatically.
- Accessible recovery screens, password confirmation/visibility controls, expired-link handling, and a sign-in-again route for older sessions.
- A deployment-only first-use authentication-secret initializer. Existing encrypted keys and working legacy runtime keys are preserved; missing keys use a valid build value or secure random generation, sent to Cloudflare through stdin without logs or files.
- Public boolean account/email capability checks, focused deployment/draft regressions, and a real-Worker account lifecycle suite with an in-memory mail sink.

### Fixed

- Disabled sign-in after a successful application build when the authentication setting exists only in the build environment instead of the Worker runtime.
- Optional runtime variables disappearing on subsequent source deployments.
- Guest imports overwriting the signup name or customized bookless shelves. The local draft is removed only after the account save succeeds.
- Failed saves preventing signout: readers can export the draft or explicitly discard unsaved work and sign out.
- Concurrent library flushes starting duplicate writes with the same revision.

### Boundaries

- Email recovery is implemented but requires the owner to configure a verified sender and test their own inbox. Without mail configuration, signup/signin still work and the limitation is visible.
- Existing readers are not forced to verify before signing in. Email-address changes and automatic account linking remain disabled.
- No new database migration, dependency, or Cloudflare resource is required for the account code. Mail-provider activation is separate from the website deployment.

## 0.5.0 — A page for every book — 2026-10-22

### Added

- Public book pages and catalog search, with work-level descriptions, authors, subjects, available editions, and shareable links. Edition cards show ISBN, page count, language, format, publisher, and publication date when available.
- Private Add to library actions from a work or a chosen edition. Edition selection preserves notes and reading history, and keeps different known editions separate.
- Cybershelf community average ratings, rating counts, completed-read totals, and unique reader counts. Readers explicitly contribute a half-star rating or dated completed read, and can remove either.
- Completed-read aggregation across editions of an identified work. A live, explicitly shared 100% journal entry contributes at most one completion per reader, without adding a duplicate to that reader's separately logged reads. Private library records never enter the aggregation.
- Conservative ISBN and exact title/author resolution for existing books, explicit choices for ambiguous matches, and an explicit title/author-only community page for books absent from the catalog.
- Book page links from search results, private book details, public shelves, and public profiles. Catalog and edition identities survive saved libraries, snapshots, and backups.
- D1 migration `0006_book_community` for minimal community catalog records, public contribution records, and the shared-post work index. The deployment reuses existing resources.

### Changed

- Combined Reading together and Reading journal into one main destination, with one page/percentage-and-thought composer and Your circle / Your journal views for the selected book.
- Private saves open the journal; explicitly shared entries open the circle. History editing, deletion, sharing, and unsharing remain available.
- Work search no longer assigns an arbitrary edition ISBN or median page count. Those fields come from a chosen edition or the reader's own entry.
- Open Library requests use bounded caching, in-flight deduplication, same-host redirect checks, response limits, and a per-isolate courtesy queue.

### Boundaries

- Community statistics are Cybershelf contributions, with honest empty states. They do not import Goodreads ratings or infer all reads from private libraries.
- Catalog coverage can be incomplete. Manually created pages do not fabricate editions, and legacy posts without a reliable work identity are not guessed into an Open Library work's totals.
- Goodreads remains CSV import; Hardcover authorization still requires owner activation. No Amazon account connection is included, and manual reading logs do not require device or progress synchronization.
- Private library ratings and public community ratings remain separate. Catalog backups do not recreate public contributions or sharing permissions.

## 0.4.0 — Reading together, connected books — 2026-10-22

### Added

- Per-book Reading together rooms: the reader’s own and followed readers’ explicitly shared thoughts, through the selected copy’s saved bookmark, in reading order or newest first.
- Server-filtered later thoughts and replies, visible-only reply counts, waiting counts, and progress-bound keyset pagination. A finished duplicate does not override a reread.
- Inline protected replies, page/percentage bookmark controls, private or explicitly shared thought composition, and refresh on focus and every 45 seconds while visible.
- Entry points from book details, the reading journal, the following feed, and main navigation.
- A Connections page and a native Hardcover browser OAuth connector, gated by the installation’s public `HARDCOVER_CLIENT_ID`. Authorization uses S256 PKCE and read scopes; tokens stay in memory and requests go directly to the provider.
- A preview before importing, optional reading progress, five-minute refresh while the authorized tab is visible, reconnect/disconnect controls, and revocation.
- Three-way metadata merging that preserves local edits, distinct editions, shelves, files, and journal entries. Remote removals never delete local books. Connection metadata survives catalog backups; credentials do not.
- Indexed book matching and bounded Unicode-aware backfill for existing shared reading posts in D1 migration `0005_reading_rooms`.
- Provider protocol, merge, persistence/privacy, and real-Worker integration coverage. Owner activation and provider capability documentation lives in `docs/account-connections.md`.

### Boundaries

- Hardcover setup is a one-time owner task; the release does not include an already registered public client ID or a completed real-user OAuth authorization test.
- Sync reads Hardcover into Cybershelf. It does not write back or continue after the browser session closes. Goodreads remains CSV import; retail account and universal reader sync are not implemented.
- Imported metadata is stored in the ordinary private library and remains accessible to the service operator. Browser-only credentials are not end-to-end encryption or protection against a malicious future version of the website.
- Shared thoughts and replies remain public writing. Reading-room protection follows declared markers and conservative title/author matching; comparisons between editions are approximate.

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
