# Architecture

This document describes the first release as implemented. The app runs on Vinext/React with a Cloudflare Worker, a D1 database, and an R2 bucket. Better Auth supplies email/password authentication and database-backed sessions on the standalone Cloudflare deployment.

## Product model

| Concept | Meaning |
| --- | --- |
| Library | The account's catalog. Entries do not assert ownership. |
| Book | Metadata, reading state, personal writing, and optional sources. |
| Source | An uploaded original, reading-platform link, other link, or physical location. |
| Shelf | A named arrangement referencing library book IDs and decorative objects. |
| Placement | One book or decoration in a numbered slot, or `null` for the staging tray. |
| Publication | An explicitly created snapshot with a public field allowlist. |

Types and shared layout rules live in [`lib/types.ts`](../lib/types.ts). A book can appear on several shelves. Removing a placement retains the library entry; removing a library entry also removes its placements. Bookcase structure and display layout determine a finite number of positions. Decorations consume positions too.

Sorting uses the positions of movable books already on the shelf. Pins, decorations, intentional gaps, and staged objects remain in place. Color sorting uses the stored hex color: local EPUB cover art can supply a sampled color, and readers can edit the color. Goodreads-only records receive a deterministic fallback because their CSV has no artwork.

## Application layers

| Area | Responsibility |
| --- | --- |
| `app/page.tsx` | Request identity and the application entry point. |
| `components/CybershelfApp.tsx` | Library, shelves, journal, Explore, settings, and editing flows. |
| `components/ShelfCanvas.tsx` | Responsive shelf rendering and item interaction. |
| `components/DecorArt.tsx` | Built-in SVG decorative objects. |
| `components/AddBooks.tsx` | Metadata lookup, import previews, and uploaded-file intake. |
| `components/BookDetails.tsx` | Sources, reading records, metadata, and book removal. |
| `components/PublicShelf.tsx` | Shared shelf display, saving a title, and copying an arrangement. |
| `lib/use-library.ts` | Account loading, autosave, version conflicts, and guest drafts. |
| `lib/import.ts` / `lib/export.ts` | Bounded imports, backups, originals, and CSV handling. |
| `lib/server/` | Validation, owner checks, storage access, and response helpers. |
| `db/schema.ts` / `drizzle/` | Database schema and immutable schema migrations. |
| `worker/index.ts` | Worker entry point and retained Sites request context. |

The maintained starter includes connector plumbing, but the first release does not use it to connect retailer or Goodreads accounts. No account synchronization should be inferred from those supporting files.

## Persistence and saves

The application data uses three tables:

| Table | Stored data |
| --- | --- |
| `libraries` | One validated JSON state per stable owner ID, a version counter, and update time. |
| `assets` | Private asset owner, type, object key, filename, MIME type, size, and creation time. |
| `publications` | Owner/shelf relationship, sanitized snapshot, public image allowlist, and timestamps. |

Better Auth additionally owns `auth_user`, `auth_session`, `auth_account`, `auth_verification`, and `auth_rate_limit`. Password hashes and session tokens stay server-side. The verification table is reserved for the maintained authentication schema; no email delivery or account-recovery flow is configured in this release.

The compact state record keeps this initial application simple and makes catalog backup straightforward. It has a 2 MB payload ceiling, 2,000-book ceiling, and 100-shelf ceiling. A larger-scale version may normalize records, but that migration must preserve IDs, exports, placements, and conflict behavior.

Signed-in saves send the expected version with the complete validated state. The database updates only when that version matches. A stale write receives HTTP 409 rather than overwriting changes from another device. The client stops automatic overwrites, retains its current working copy, and offers export and reload.

Anonymous edits use a clearly labelled browser-local draft. They are not synchronized records. A signed-in account loads D1 state, and a browser draft can be brought into an empty account deliberately.

## API surface

| Endpoint | Access and purpose |
| --- | --- |
| `GET /api/auth/*`, `POST /api/auth/*` | Better Auth session, signup, sign-in, and sign-out endpoints. |
| `GET /api/state` | Signed-in owner: current state, version, and initial display name. |
| `PUT /api/state` | Signed-in owner: validated versioned save and removal of publications for deleted shelves. |
| `GET /api/assets` | Signed-in owner: uploaded-asset inventory and storage usage. |
| `POST /api/assets` | Signed-in owner: bounded multipart book/image upload. |
| `GET /api/assets/[id]` | Asset owner only: original file or private image. |
| `DELETE /api/assets/[id]` | Asset owner only: removal subject to reference checks. |
| `GET /api/search?q=...` | Bounded metadata search backed by Open Library. |
| `GET /api/publications` | Published shelf snapshots, paginated for Explore. |
| `POST /api/publications` | Signed-in owner: publish/update a snapshot of a saved shelf. |
| `GET /api/publications/[id]` | Read one published snapshot. |
| `DELETE /api/publications/[id]` | Publication owner only: revoke the snapshot. |
| `GET /api/publications/[id]/assets/[assetId]` | Read an image explicitly allowlisted by an existing publication. |

Public shelf endpoints allow anonymous visitors. Private data and application mutations require a valid account session. An optional outer access restriction would also restrict share links.

Write handlers validate request origin where supplied, require identity, and validate content. The server verifies that referenced private assets belong to the current account and have the required kind. Client-side parsing improves feedback but is not an authorization boundary.

## Files and publishing

R2 objects are private. An object ID or URL alone is insufficient to retrieve an original book. The private asset route looks up the current owner and returns an attachment for book files. File-type detection checks supported signatures instead of trusting the filename or browser MIME label.

Publishing starts from the saved owner state and builds a fresh object using an explicit allowlist. That object includes only visible book metadata, the shelf's presentation, the chosen public display name, and decorative content. It omits:

- Original book files and private file IDs.
- Reading-platform links, other sources, and physical locations.
- Reading progress, ratings, reviews, and private notes.
- Profile biography and email address.
- Unplaced books and objects in the staging tray.

Uploaded cover art and custom decorations are different from book originals: when visible on a published shelf, their verified image IDs are added to that publication's image allowlist. The image endpoint requires an existing publication and a matching image asset. It never exposes assets of kind `book`. Public responses use generic image filenames rather than private original filenames.

Unpublishing deletes the snapshot and revokes its image paths. Deleting a shelf revokes its publication when the library save succeeds. Ordinary library edits remain private until an explicit snapshot update. A published shelf is therefore a deliberate saved view, not a live view into the private account.

Copying a shared shelf imports its public book metadata and built-in objects. Personal uploaded decorations are omitted. A copied book's published cover reference can disappear if its original owner unpublishes; it does not become a copy of the owner's private file.

## Import and backup boundaries

Goodreads CSV parsing handles quoted fields and multiline text. Duplicate detection uses ISBN where present, otherwise normalized title/author matching. Separate known ISBN editions can coexist. Ordinary catalog imports keep existing notes and sources; uploaded-file imports can append new file sources while preserving the existing reading record.

EPUB intake reads its ZIP central directory, then only bounded package metadata and supported cover artwork. Streamed decompression stops when an output limit is exceeded. XML custom entities are rejected. The app does not execute EPUB content or render a full EPUB reader. Metadata failure returns an editable fallback while preserving the original-file workflow.

The complete backup uses ordinary, uncompressed ZIP entries so the file bytes remain unchanged. `catalog.json` holds the account state; `manifest.json` maps private asset IDs to original files in the archive. JSON import removes old publication identities. Restoring elsewhere requires uploading originals and replacing the old private asset references; the server does not treat a backup as permission to access another account.

## Identity and hosting

[`app/auth.ts`](../app/auth.ts) resolves a signed cookie through Better Auth and D1. The stable account ID is the ownership key. Cookies are HTTP-only, SameSite=Lax, and Secure on HTTPS. Sessions expire after 30 days and are checked against D1; the session cookie cache is disabled. Sign-out is a POST and revokes the session. The application never accepts `oai-authenticated-*` headers as proof of identity.

[`lib/server/auth.ts`](../lib/server/auth.ts) configures an explicit `APP_ORIGIN`, a required random `BETTER_AUTH_SECRET`, maintained password hashing, and database-backed rate limits. Cloudflare’s `CF-Connecting-IP` supplies the rate-limit address; forwarding headers chosen by a caller do not establish identity. Accounts have unverified email addresses until an actual verification flow is added. Account linking is disabled. A missing auth configuration disables account sign-in while keeping guest browsing available.

Private mutation requests carry `X-Cybershelf-Account` as an identity precondition. The server compares it with the authenticated session; the header cannot grant access. This prevents an old tab from saving one reader’s library into another reader’s account after a cookie/session change. Optimistic library versions separately prevent concurrent overwrite within the same account.

Public snapshots use the chosen profile display name and do not fall back to publishing an email address. Moving records from another deployment or identity provider requires a verified mapping of old and new owners; raw ownership IDs do not transfer access.

The root `wrangler.jsonc` owns the production Worker name, bindings, canonical origin, and custom domain. Its D1 UUID is a resource identifier, not a credential. The build derives `dist/server/wrangler.json`; deployments use that generated file. `scripts/deploy-cloudflare.mjs` applies only pending D1 migrations before uploading the Worker and stops if a migration fails. Request handlers never create tables. Local and integration-test storage is separate from production.

The retained `.openai/hosting.json` records the original development Site identity. It does not configure authentication for this standalone release and is not the destination of `pnpm run deploy`.

## External requests and future work

Metadata search sends the query to Open Library. External cover URLs load from their respective hosts. Platform source links navigate to those services; they do not establish linked-account access or file export rights.

Future account connectors, OPDS support, progress synchronization, public reviews, and richer physical planning should be separate additions with visible capability boundaries. They are not implemented by this first-release architecture.
