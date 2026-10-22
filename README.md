# // cybershelf

A place to collect books, arrange personal shelves, and keep a reading life within reach.

cybershelf separates a **Library** from the shelves you make with it. A book can be something you own, borrowed, have read, or simply want to remember. Add it once, then display it on as many themed shelves as you like. The `//` mark is two books leaning together.

This repository contains the first release: a React application, its server API, database migrations, and the Sites hosting integration. The source is MIT licensed. The canonical source repository is [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf). `cybershelf.io` is the intended custom domain; domain setup is separate from building this source. See [release status](docs/release-status.md) for the current verification and deployment status.

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

Use Node.js 24 for development and the test runner; the application package declares Node.js 22.13 or newer. Install the package manager version pinned in `package.json` and use the committed lockfile. The current checkout uses pnpm:

```sh
pnpm install --frozen-lockfile
pnpm run build
```

Use the committed `pnpm-lock.yaml`; do not mix package managers or run simultaneous installers. `install:ci` is maintained for the Sites environment and may use environment-specific setup. A clean external clone defaults to the portable execution profile.

The build generates `dist/server/wrangler.json`. Apply the committed migration to a new local database before using saved libraries:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_awesome_zarda.sql
```

Do not replay an already applied migration. Start the portable development server:

```sh
pnpm run dev
```

Use the loopback URL printed by the server. The portable development profile includes local-only simulated sign-in; its identity is a development fixture. Production sign-in is supplied by Sites. `pnpm run start` previews the built Worker locally and does not deploy it.

In a managed ChatGPT Sites workspace, follow the Sites helper workflow for installation, migrations, supervised preview, packaging, and deployment. Keep the existing `project_id` when updating this deployment. The internal preview URL is not a public site URL.

### Checks

After dependency installation, run the complete checks with:

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

Regression coverage lives in `tests/import.test.ts`, `tests/arrange.test.ts`, and `lib/server/server.test.mjs`. `lib/server/integration.test.mjs` exercises owner isolation and publication access against a local preview when `CYBERSHELF_TEST_BASE_URL` is set to a loopback origin. It refuses remote targets and creates temporary test data.

## Backup and restore

JSON exports preserve catalog metadata, shelves, journal entries, and private file references. Restoring JSON on the original account reconnects files that still exist. A ZIP export additionally contains original uploads and a manifest mapping asset IDs to archive paths.

This release restores the catalog JSON, not the ZIP as a single operation. For a different account or deployment, upload the files again and reconnect them; an imported asset ID does not transfer access to another account's files. Externally hosted covers and retailer purchases remain external links. Keep backups somewhere private if they contain notes, reviews, sources, or book files.

## Hosting and contributing

The current runtime is Vinext on Cloudflare Workers, with D1 for account records and publication snapshots and R2 for uploaded files. GitHub stores and collaborates on the source; a static GitHub Pages deployment alone cannot run these authenticated APIs.

Self-hosting is possible, but it requires an authentication adapter and Cloudflare resource configuration. The provided ChatGPT auth headers are trustworthy only behind the Sites authentication boundary. **Do not expose a standalone deployment that accepts caller-supplied identity headers.** Read [self-hosting](docs/self-hosting.md) before deploying outside Sites.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md), and [CHANGELOG.md](CHANGELOG.md).

## License and artwork

Original cybershelf code and built-in SVG decorations are available under the [MIT license](LICENSE). Retained framework tooling, dependencies, and vendored assets keep their own license notices. Book titles and author names in the demo identify sample catalog entries; they do not claim ownership or endorsement. External book cover images and user-uploaded artwork remain subject to their owners' rights and are not relicensed by this repository.
