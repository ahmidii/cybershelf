# cybershelf

A place to collect books, arrange personal shelves, and keep a reading life within reach.

cybershelf separates a **Library** from the shelves you make with it. A book can be something you own, borrowed, have read, or simply want to remember. Add it once, then display it on as many themed shelves as you like. The `cybershe\f` wordmark and `||\` icon echo upright and leaning books, paired with a consistent serif-and-sans interface.

This source prepares the **0.8.0 public-beta candidate**: username accounts without a required email, recovery keys, complete account-deletion requests, reporting and blocking, a moderator queue, and atomic upload quotas. It retains page-based reading updates, touch shelf controls, and real spine-photo cropping. Better Auth and its adapter are pinned to 1.7.16 under the maintainer-approved, exact-version dependency-age exceptions.

The source is MIT licensed. The canonical repository is [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf), and the deployment configuration targets `cybershelf.io` in the maintainer’s Cloudflare account. **Local acceptance passed: 201 regression cases, the production Worker integration suite, and an isolated recovery rehearsal. Confirm production publication from the commit’s Cloudflare build check and live health endpoint.** Production moderation setup, administrator security, bucket privacy, backups, restoration, and alert delivery need recorded operational evidence before a wider launch. See [release status](docs/release-status.md) and [beta readiness](docs/beta-readiness.md).

## What you can do

- **Keep your account within reach:** sign up with a username and password without providing an email address, and save the recovery key shown after signup. Existing email accounts keep their login and email recovery, and can claim a username. Account & security supports changing a password, replacing a recovery key, and signing out other devices.
- **Explore a book:** open a shareable page with its synopsis, author, available editions, and Cybershelf community ratings and completed reads. Pick an edition for its ISBN and page count, or add the work directly to your private library.
- **Collect books:** search book metadata, enter a title manually, import a Goodreads CSV, or upload an EPUB/PDF. File imports can attach another original to an existing book without replacing its reviews or notes.
- **Make several shelves:** name and duplicate them, choose Open shelves, Cubby, or Tower, and combine Spines together, Gallery, or Stacks layouts with Paper, Warm oak, Moss, or Ink finishes.
- **Arrange directly:** drag a book or decoration anywhere along a shelf, with a live ghost of its settled position. Books make room, join a horizontal stack, or lean against nearby support. Use the mouse wheel while dragging or the on-screen pose controls to choose Auto, Spine, Cover, Stack, or a lean. On a phone or tablet, open **Arrange shelf**, drag with a finger, and release to place; larger touch controls choose the pose. For one-handed placement, pick up a selected book, tap a destination, choose its pose, and confirm. Fine-position arrows and keyboard controls use the same placement engine. Every committed move can be undone.
- **Make books feel physical:** use proportional heights and spine widths, tightly packed spines, cover-out displays, horizontal piles, and supported leaning. ISBN-specific metadata can improve dimensions; otherwise estimates work immediately. In Book details, take or choose a real spine photo, crop and rotate it, and preview it on the selected copy. Only the cropped image is uploaded. A typographic spine remains the clearly labelled fallback when authentic artwork is unavailable.
- **Decorate:** use the built-in plant, bear, robot, vase, and bookend, or upload a PNG, JPEG, or WebP image.
- **Grab a book:** download your uploaded original, open a saved reading-platform or library link, or check the location of a physical copy. A catalog entry does not imply ownership.
- **Keep your reading life together:** one Reading together destination contains your circle and your journal for the selected book. Enter the page you reached and the percentage calculates from your edition's page count. Missing totals are requested once; percentage entry is an optional alternative for reading apps. Save privately or deliberately share an individual update. Each entry retains its original marker as you read on, exact bookmarks survive backups, and existing reviews and notes remain private.
- **Read together, at your own pace:** open a book’s reading room to see your followed readers’ and your own shared thoughts through the selected copy’s saved bookmark. Read in book order or newest first, reply inline, and uncover more as you read. Later text is withheld by the room API, including replies. A finished second edition does not override a reread.
- **Contribute to a book’s community:** explicitly save a public rating or log a dated completed read. Half-star ratings, rereads, and removal are supported. Private ratings, imports, and library status changes never silently become community contributions.
- **Connect a book account:** when the installation enables Hardcover, authorize directly with the provider, review the import, and refresh book metadata while Cybershelf is open. Progress sync is optional. Your edits, files, shelves, and private journal are retained. Provider credentials stay in browser memory; imported metadata is stored in your Cybershelf account. [Owner setup and privacy details](docs/account-connections.md).
- **Introduce yourself:** choose one featured shelf, preview your profile, and publish it when ready. Your profile has a stable public link while published.
- **Read with company:** follow public profiles, browse shared reading journeys, and reply to individual entries with your own progress marker. Thoughts beyond your saved progress, or about unread books, are hidden by default until you reveal them.
- **Keep a reading circle:** the Following feed includes shared journal updates, replies, newly published or updated shelves, and explicit “bought a book” / “added to my library” posts. Private library changes and imports are never broadcast.
- **Share deliberately:** publish a shelf snapshot, browse published shelves, save an interesting title, or make your own version of another shelf's arrangement. Custom artwork stays with its owner when a shelf is copied.
- **Choose your company:** report public content, block a reader, and manage blocks in **Safety & blocked readers**. Blocking removes mutual follows and filters both readers' signed-in views. Public content remains accessible to signed-out visitors.
- **Take your data with you:** export catalog/shelves as JSON, reading records as CSV, and uploaded originals in a ZIP backup.
- **Leave when you choose:** delete your account from **Account & security** after a fresh sign-in, current-password check, and explicit confirmation. Account access and associated live records are removed together; file erasure is durably retried if storage is temporarily unavailable.

The guest preview is labelled sample content. Editing as a guest creates a draft in that browser. Sign in to save an account library across devices, upload files, and publish shelves. Importing a browser draft into an untouched account preserves the signup name and removes the local draft only after a successful save. A customized account collection is never replaced by this shortcut. A browser draft is not a substitute for an account backup.

## What this release does not connect automatically

Hardcover is the first account connector, with one-way metadata import and optional progress import. The owner must register a public OAuth application and configure `HARDCOVER_CLIENT_ID` before readers can authorize it. Sync checks run every five minutes while the authorized tab is visible; reloading or closing the page discards credentials and requires reconnecting. It does not write changes back to Hardcover or run while the app is closed.

Goodreads support is a **CSV import**, not a live account connection. Reading-platform sources are links you save. Purchase announcements are manual, explicit shares. There is no automatic retailer purchase synchronization, DRM removal, universal cross-reader progress synchronization, OPDS server, or full in-browser EPUB reader in this release. Uploaded originals can be downloaded and opened in a compatible reader; platform links open the respective service.

A shelf is useful for planning a physical arrangement. Books use approximate millimetre proportions and continuous horizontal positions. The placement preview checks walls, neighboring books, and stack supports; a full row asks you to choose another spot or turn the book. Existing crowded arrangements still scale together to remain visible. This is a visual preview, not a guarantee that books fit a real bookcase. Metadata is often incomplete, so estimated dimensions are labelled and editable.

The current catalog integrations do not provide a documented, reliably identified spine-image field. Open Library's [Covers API](https://openlibrary.org/dev/docs/api/covers) supplies cover images, while Google Books' [volume image links](https://developers.google.com/books/docs/v1/reference/volumes) describe image sizes. Cybershelf therefore does not claim that a generated spine matches the printed edition. A photo or tightly cropped image link supplies the actual artwork. Changing an established edition clears its old spine image; equivalent ISBN-10 and ISBN-13 forms preserve it.

## Book pages and editions

[Explore books](https://cybershelf.io/books) searches the Open Library catalog. Each work has one public page at `/books/OL…W`; its editions have separate identifiers, ISBNs, page counts, languages, formats, publishers, and dates when the catalog supplies them. Work search never assigns the first available edition’s ISBN or a median page count to your copy. A known edition can be selected on the book page. Existing books can find a page through a verified ISBN or exact title/author match; ambiguous results require a choice.

For a title absent from the external catalog, a signed-in reader can explicitly create a community page from Book details. That action publishes only its title and author. It does not expose the book file, uploaded artwork, source links, private notes, or ratings. Manually created pages do not invent editions or enrich missing metadata automatically.

Community statistics are Cybershelf contributions, not Goodreads or Open Library popularity. One current rating per reader contributes to the average. Completed reads include explicitly logged dates and a reader’s currently public 100% reading update; the latter counts at most once and is not added on top of the same reader’s existing completed-read total. Distinct dates can represent rereads. Unique reader counts and total read counts are separate. New pages honestly start with no ratings and zero logged reads.

Public ratings and explicit completed-read logs are separate from private Library data and can be removed on the book page. Unsharing a completed journal update or unpublishing its profile removes that update’s contribution. It does not remove a separately saved community rating or completed-read log. Older reading posts without an established work identity are not guessed into an Open Library work’s totals. Available editions and metadata depend on catalog coverage; the interface does not promise every edition ever published.

## Private libraries and deliberate sharing

Your account library, source links, physical locations, original book files, reviews, and private notes stay private. Publishing a shelf creates a separate snapshot containing the display name, shelf title/description, visible books, arrangement, and decorations. The staging tray is excluded. Selecting a featured shelf stays private until you publish your profile, which is independent of Explore shelf publications.

Private account data is protected by authorization. It is not end-to-end encrypted: the service operator can access stored library metadata and files. The Hardcover connector does not send provider tokens to the server, persist them in browser storage, or put them in backups. Its read scopes exclude account/email access and writes. Operator control of delivered JavaScript remains a trust boundary.

Reading entries start private. **Share update** publishes only the chosen entry, its marker, and the book’s public metadata. Future edits stay private until you update the shared entry. Replies are public within that conversation. Do not put later events under an earlier marker: spoiler controls compare declared progress, not the meaning of the text, and public writing is not confidential. Editions are matched conservatively by normalized title and author, with percentages used across page counts; readers can adjust the protection locally.

Uploaded cover/spine images and decorations in a published snapshot use revocable public image links. Original book files never use those paths. Unpublishing a profile hides its journal and profile-linked activity; publishing a new profile does not automatically re-share the old journal entries. Unsharing an entry removes its conversation. Deleting a private entry or book also removes its shared entry after the library save succeeds. Separately published shelves remain visible until explicitly unpublished. Copies already saved by someone else cannot be recalled.

Follows connect readers to a currently public profile. Book purchases and additions are shared explicitly; a library entry does not prove ownership. New shelf activity is based on publishing a shelf, never on creating a private draft. The feed refreshes when opened, when the tab returns to focus, and periodically while visible; a manual refresh control is also available. No email, push notification, or automatic retailer connection is added.

See [the architecture notes](docs/architecture.md) for the API and ownership boundaries.

## Account deletion and community safety

An accepted account-deletion request removes the account, sessions, recovery credentials, private library, published shelves/profile, reading content, follows, contributions, and linked report/audit text in one database transaction. Uploaded originals and artwork lose their serving records immediately. Durable cleanup removes the bytes or, for an unresolved in-flight write, replaces them with an empty cancellation marker that cannot be used to retrieve the original. A temporary storage outage leaves a retryable obligation without restoring account access. Shared title/author catalog records have no account owner and can remain as bibliographic data. Saved copies held by other people cannot be recalled.

Reports resolve their target from existing public records and contain a bounded public excerpt plus the reporter's explanation. The reported reader does not receive the reporter's identity or explanation. Blocks are reciprocal for authenticated views and stop new follows/replies; unblocking does not recreate a follow. Both controls are enforced on the server. Public information can still be viewed while signed out, so blocking is not a privacy boundary.

The moderator queue at `/moderation` uses an explicit allowlist of immutable Cybershelf account IDs in `MODERATOR_USER_IDS`. There is no default administrator or automatic first-user promotion. Moderators can hide or restore reported content and pause or restore public participation, with a recent sign-in and an audit note. Suspended accounts retain private-library, export, security, and deletion access. The queue does not open unrelated private libraries or uploaded files. Operators still need to configure real moderators, assign review coverage, and provide a suitable private support contact. See [moderation](docs/moderation.md) and [upload storage](docs/upload-storage.md).

## Release limits

| Resource | Limit |
| --- | --- |
| Books in a library | 2,000 |
| Shelves in a library | 100 |
| Catalog payload | 2 MB |
| EPUB or PDF upload | 25 MiB per file |
| PNG, JPEG, or WebP upload | 4 MiB per file |
| Uploaded storage | 500 MiB or 1,000 files per account, including reservations and pending cleanup |
| Active upload reservations | 4 per account |
| Goodreads CSV import | 10 MB and 2,000 book rows |
| Complete ZIP export | 100 MB |
| Reading updates | 200 per book, 4,000 characters each |
| Replies | 100 per shared entry, 4,000 characters each |
| Reply posting | 10 per minute and 200 per day |
| Following | 500 readers |
| Blocked readers | 500 per account |
| Report attempts | 5 per minute and 25 per day per account |
| Connected accounts | 10 |

Limits are implemented using powers of 1,024 bytes. Upload quota is reserved in one conditional database statement, so simultaneous requests cannot each consume the same remaining allowance. Multipart parsing and upload attempts have additional time, memory, and rate bounds described in [upload storage](docs/upload-storage.md). Large libraries can export their catalog and download originals individually if they exceed the ZIP limit. Unknown or unreadable book metadata remains editable.

## Run locally

Use Node.js 24 and the pnpm version pinned in `package.json` (11.25.0). From a clean clone:

```sh
pnpm install --frozen-lockfile
pnpm run setup:local
pnpm run db:migrate:local
pnpm run dev
```

Open **http://localhost:5173**. The setup command creates an ignored `.dev.vars` file with a random local authentication secret and that exact origin. Create a local account through the normal sign-in screen. Local D1 and R2 use `.wrangler/state`; they do not access the production resources even though the deployment identifiers are in `wrangler.jsonc`. The migration command tracks completed files, so it is safe to repeat after an update.

If you use another hostname or port, update `APP_ORIGIN` in `.dev.vars` to match it exactly. `localhost` and `127.0.0.1` are different origins. Do not commit `.dev.vars`, production secrets, or local databases.

Use the committed lockfile and one installer at a time. A clean clone uses the portable execution profile. The retained `install:ci` and managed-workspace helpers are for the original Sites development environment.

### Checks

```sh
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:worker
pnpm run deploy -- --dry-run
```

The regression and Worker suites cover imports, backup round trips, physical shelf geometry, reading markers, validation, public/private separation, authentication, account deletion, moderation, blocks, and upload concurrency. Worker checks use disposable local D1/R2 storage and real test-account/session cookies. They do not use the production database or send account email to real recipients. A deploy dry run validates the upload without applying remote migrations or publishing. Available test cases are not a claim that this candidate's final run has passed; [release status](docs/release-status.md) records that separately.

`pnpm run start --port 5173` previews the built Worker locally. Match `.dev.vars` to the origin you open. The separate `test:integration` command can target an existing local server through `CYBERSHELF_TEST_BASE_URL`; it refuses remote targets and creates temporary test accounts.

## Backup and restore

### Your library exports

JSON exports preserve catalog metadata, physical book appearance, shelves, the featured-shelf choice, private journal entries, file references, and connection preferences/provenance. They contain no provider credentials; accounts must be authorized again after restoring. They retain catalog work and edition identities, but do not transfer public profile identities, follows, public conversations, community ratings/read contributions, or publication permissions. CSV exports include reading-log JSON in an optional column. Restoring JSON on the original account reconnects files that still exist. A ZIP export additionally contains original uploads and a manifest mapping asset IDs to archive paths.

This release restores the catalog JSON, not the ZIP as a single operation. For a different account or deployment, upload the files again and reconnect them; an imported asset ID does not transfer access to another account's files. Externally hosted covers and retailer purchases remain external links. Keep backups somewhere private if they contain notes, reviews, sources, or book files.

### Operator recovery

D1 recovery covers database records; it does not contain uploaded file bytes. The optional `BACKUP_BUCKET` stores separate private recovery copies of committed originals and artwork. Complete-scan freshness is tracked separately from whether the binding is configured. These periodic copies can lag new uploads and are not an atomic database-and-file snapshot. See [original file backups](docs/original-backups.md).

The operator policy limits recovery copies and SQL/incident exports to 30 days. Storage expiration is asynchronous and may finish later, so this is a retention policy rather than a guarantee of removal at an exact second. A minimal erasure ledger retains only an opaque former account ID and deletion/expiry timestamps for 35 days. Any surviving backup history must fit within that reconciliation window; operators must address delayed expiry before restoring older data.

A restore must preserve and apply the latest trusted account-security state and current erasure ledger before recovering files or serving traffic. It must revoke restored sessions/reset tokens and honor current suspensions, blocks, hiding, and publication withdrawals. An old database alone is not a safe source of current passwords or consumed recovery keys. The [production operations runbook](docs/production-operations.md) describes isolated rehearsal, reconciliation, privacy checks, and alert verification. Source tooling and a local drill do not prove that production backups or a production restore work.

## Hosting and contributing

The current runtime is Vinext on Cloudflare Workers, with D1 for account records and publication snapshots and R2 for uploaded files. GitHub stores and collaborates on the source; a static GitHub Pages deployment alone cannot run these authenticated APIs.

Standalone hosting is configured in `wrangler.jsonc`: Worker `cybershelf`, D1 `cybershelf-db` as `DB`, private R2 `cybershelf-files` as `BUCKET`, and the `cybershelf.io` custom domain. The deploy script first provisions/verifies the separate private `cybershelf-backups` bucket and its 30-day expiry rule, applies pending migrations, publishes the built Worker, and configures a missing authentication secret through Cloudflare's encrypted runtime-secret API. Configured keys are preserved. It then checks public account capability flags and records a sanitized, read-only operations audit. Unknown production checks remain explicitly unverified. Follow the [Cloudflare setup guide](docs/self-hosting.md) for the GitHub connection, build-token permission, and email activation. Forks must replace the resource identifiers and domain with their own.

Accounts use Better Auth with database-backed sessions and rate limiting. Requests cannot establish identity by supplying legacy hosting headers. New accounts need only a username and password; save the recovery key because an account without email cannot receive a reset link. Recovery keys are hashed in the database, replaced when used, and never included in library exports. New passwords use a versioned, salted scrypt hash; older hashes remain verifiable until the password changes. Account settings require the current password for sensitive changes and support revoking other sessions. Existing email accounts retain Resend-based confirmation and recovery; production email requires `RESEND_API_KEY` and `AUTH_EMAIL_FROM` with a verified sending domain. Reset links expire after one hour and revoke existing sessions when used. [Enable account email](docs/self-hosting.md#6-enable-account-email).

Username accounts provide pseudonymity. They do not provide complete anonymity: server operators can access stored account and library data, hosting infrastructure processes network information, and public names or posts can identify a reader. See the in-app `/privacy` page and the [beta readiness assessment](docs/beta-readiness.md) for privacy boundaries and the evidence still needed before wider release.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md), and [CHANGELOG.md](CHANGELOG.md).

## License and artwork

Original cybershelf code and built-in SVG decorations are available under the [MIT license](LICENSE). Retained framework tooling, dependencies, and vendored assets keep their own license notices. Book titles and author names in the demo identify sample catalog entries; they do not claim ownership or endorsement. External book cover images and user-uploaded artwork remain subject to their owners' rights and are not relicensed by this repository.
