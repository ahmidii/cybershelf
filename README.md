# // cybershelf

A place to collect books, arrange personal shelves, and keep a reading life within reach.

cybershelf separates a **Library** from the shelves you make with it. A book can be something you own, borrowed, have read, or simply want to remember. Add it once, then display it on as many themed shelves as you like. The `//` mark is two books leaning together.

This repository contains the first release: a React application, its server API, database migrations, and a standalone Cloudflare deployment with email/password accounts. The source is MIT licensed. The canonical source repository is [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf). The deployment configuration targets `cybershelf.io` in the maintainer’s Cloudflare account; building the source alone does not activate the domain. See [release status](docs/release-status.md) for the current verification and deployment status.

## What you can do

- **Collect books:** search book metadata, enter a title manually, import a Goodreads CSV, or upload an EPUB/PDF. File imports can attach another original to an existing book without replacing its reviews or notes.
- **Make several shelves:** name and duplicate them, choose Open shelves, Cubby, or Tower, and combine Balanced, Gallery, or Stacks layouts with Paper, Warm oak, Moss, or Ink finishes.
- **Arrange with control:** move books, change how they face, pin objects, and preview sorting by title, author, or stored cover color. Apply or cancel a preview, or undo a shelf edit. Smaller layouts keep overflow in **Not placed yet**.
- **Decorate:** use the built-in plant, bear, robot, vase, and bookend, or upload a PNG, JPEG, or WebP image.
- **Grab a book:** download your uploaded original, open a saved reading-platform or library link, or check the location of a physical copy. A catalog entry does not imply ownership.
- **Keep a reading journal:** set reading status and manual progress, rate books, and write reviews or private notes. The first-release journal and reviews are private.
- **Share deliberately:** publish a shelf snapshot, browse published shelves, save an interesting title, or make your own version of another shelf's arrangement. Custom artwork stays with its owner when a shelf is copied.
- **Take your data with you:** export catalog/shelves as JSON, reading records as CSV, and uploaded originals in a ZIP backup.

The guest preview is labelled sample content. Editing as a guest creates a draft in that browser. Sign in to save an account library across devices, upload files, and publish shelves. A browser draft is not a substitute for an account backup.

## What this release does not connect automatically

Goodreads support is a **CSV import**, not a live account connection. Reading-platform sources are links you save. There is no automatic retailer purchase synchronization, DRM removal, cross-reader progress synchronization, OPDS server, or full in-browser EPUB reader in this release. Uploaded originals can be downloaded and opened in a compatible reader; platform links open the respective service.

A shelf is also useful for planning a physical arrangement, but its geometry is a visual preview. It does not measure your books or promise that they fit a real bookcase.

## Private libraries and public shelves

The account library, source links, physical locations, original book files, reading progress, reviews, and notes stay private. Publishing constructs a separate snapshot containing the chosen display name, shelf title and description, visible books, arrangement, and decorations. The staging tray is excluded. Editing a library does not update that snapshot until the owner publishes an update.

Uploaded cover images and decorations used in a published snapshot are accessible through that publication. Original book files never use that public path. Unpublishing removes the snapshot and its image access; it cannot recall a copy someone already downloaded or saved. A hosting-level audience restriction still applies if the entire deployed site is private.

See [the architecture notes](docs/architecture.md) for the API and ownership boundaries.

## First-release limits

| Resource | Limit |
| --- | --- |
| Books in a library | 2,000 |
| Shelves in a library | 100 |
| Catalog payload | 2 MB |
| EPUB or PDF upload | 25 MB per file |
| PNG, JPEG, or WebP upload | 4 MB per file |
| Uploaded storage | 500 MB or 1,000 files per account |
| Goodreads CSV import | 10 MB and 2,000 book rows |
| Complete ZIP export | 100 MB |

Limits are currently implemented using powers of 1,024 bytes. Large libraries can export their catalog and download originals individually if they exceed the ZIP limit. Unknown or unreadable book metadata remains editable.

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

The regression suite covers imports, backups, shelf arrangements, validation, public/private field separation, and authentication boundaries. The Worker integration check runs the built application with disposable local D1/R2 storage and real account/session cookies. It does not use the production database or a Cloudflare API token. A deploy dry run validates the upload without applying remote migrations or publishing.

`pnpm run start --port 5173` previews the built Worker locally. Match `.dev.vars` to the origin you open. The separate `test:integration` command can target an existing local server through `CYBERSHELF_TEST_BASE_URL`; it refuses remote targets and creates temporary test accounts.

## Backup and restore

JSON exports preserve catalog metadata, shelves, journal entries, and private file references. Restoring JSON on the original account reconnects files that still exist. A ZIP export additionally contains original uploads and a manifest mapping asset IDs to archive paths.

This release restores the catalog JSON, not the ZIP as a single operation. For a different account or deployment, upload the files again and reconnect them; an imported asset ID does not transfer access to another account's files. Externally hosted covers and retailer purchases remain external links. Keep backups somewhere private if they contain notes, reviews, sources, or book files.

## Hosting and contributing

The current runtime is Vinext on Cloudflare Workers, with D1 for account records and publication snapshots and R2 for uploaded files. GitHub stores and collaborates on the source; a static GitHub Pages deployment alone cannot run these authenticated APIs.

Standalone hosting is configured in `wrangler.jsonc`: Worker `cybershelf`, D1 `cybershelf-db` as `DB`, private R2 `cybershelf-files` as `BUCKET`, and the `cybershelf.io` custom domain. The deploy script applies pending migrations before publishing the built Worker. Follow the [Cloudflare setup guide](docs/self-hosting.md) for the GitHub connection, build-token permission, and required `BETTER_AUTH_SECRET`. Forks must replace the resource identifiers and domain with their own.

Accounts use Better Auth with database-backed sessions and rate limiting. Requests cannot establish identity by supplying legacy hosting headers. This release does not send verification or password-reset emails; readers should keep their passwords in a password manager. Adding recovery requires an email delivery service and an explicit recovery flow.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md), and [CHANGELOG.md](CHANGELOG.md).

## License and artwork

Original cybershelf code and built-in SVG decorations are available under the [MIT license](LICENSE). Retained framework tooling, dependencies, and vendored assets keep their own license notices. Book titles and author names in the demo identify sample catalog entries; they do not claim ownership or endorsement. External book cover images and user-uploaded artwork remain subject to their owners' rights and are not relicensed by this repository.
