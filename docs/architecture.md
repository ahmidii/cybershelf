# Architecture

This document describes version 0.2 as implemented. The app runs on Vinext/React with a Cloudflare Worker, a D1 database, and an R2 bucket. Better Auth supplies email/password authentication and database-backed sessions on the standalone Cloudflare deployment.

## Product model

| Concept | Meaning |
| --- | --- |
| Library | The account's catalog. Entries do not assert ownership. |
| Book | Metadata, reading state, personal writing, and optional sources. |
| Source | An uploaded original, reading-platform link, other link, or physical location. |
| Shelf | A named arrangement referencing library book IDs and decorative objects. |
| Placement | One book or decoration with a row, normalized horizontal center, and optional supporting item; the legacy `slot: null` marker identifies the staging tray. |
| Publication | An explicitly created shelf snapshot with a public field allowlist. |
| Public profile | A separately published identity, bio, and featured-shelf snapshot. |
| Reading entry | A private thought or milestone with its own time, page, and percentage. |
| Reading post | One explicitly shared entry snapshot, tied to the exact published profile identity. |
| Reply | A public response attached to one reading post, with a spoiler-progress marker. |
| Follow | An authenticated reader’s subscription to another reader’s public activity. |

Types and shared layout rules live in [`lib/types.ts`](../lib/types.ts). A book can appear on several shelves. Removing a placement retains the library entry; removing a library entry also removes its placements. Bookcase structure determines rows and physical compartments. Continuous placements are limited by available physical space, not a fixed number of grid cells. Legacy slot identifiers remain for compatibility and visibility checks, but do not determine free-position coordinates.

Sorting uses the positions of movable books already on the shelf. A continuous position includes its facing, lean, and stack role; support references follow the book occupying that role. Decorations, intentional gaps, staged objects, and retained legacy pins remain in place during sorting. Direct manipulation always releases the moved item from a legacy pin. Color sorting uses the stored hex color: local EPUB cover art can supply a sampled color, and readers can edit the color. Goodreads-only records receive a deterministic fallback because their CSV has no artwork.

## Physical shelf layout

`lib/book-size.ts` supplies stable millimetre dimensions. Stored measurements win; format and page count provide bounded estimates. ISBN lookup accepts matching edition metadata, labels the source, and falls back when data is missing. Spine artwork is optional and separately editable; generated spines are not claimed to be actual publisher images.

`lib/shelf-geometry.ts` renders continuous positions from `placement: { row, x, supportId? }`, where `x` is the normalized horizontal center across the row. Legacy numbered arrangements are rendered faithfully until they are materialized into coordinates. Horizontal piles use explicit support chains and cumulative book thickness. A leaning book needs a wall, upright neighbour, horizontal pile, or bookend within reach. Collision and contact geometry are deterministic.

`lib/shelf-placement.ts` supplies one pure operation for the drag preview and final placement. It lifts the selected item, settles the remaining pile, finds the intended compartment, checks possible stack supports, snaps nearby edges, and moves neighboring items only as needed. The result includes the exact geometry, validity, and a short contextual placement hint. Coordinates are saved from the settled result so other books do not spring back to old pointer targets on a later edit. A full row cannot accept another footprint; existing oversized arrangements remain visible through uniform scaling.

`components/ShelfCanvas.tsx` uses Pointer Events for mouse, pen, and touch instead of native HTML drag-and-drop. Continuous pointer coordinates drive a translucent landing ghost. Wheel input during a drag and visible pose buttons select Auto, Spine, Cover, Stack, or leaning; the page retains ordinary scrolling outside a drag. Keyboard and tap-to-place controls provide alternatives. A completed placement is one undoable shelf change, while cancellation preserves the original shelf. Public and compact shelves remain read-only.

`lib/shelf-actions.ts` reconnects a pile when an item is set aside or removed and remaps supporting item IDs when an arrangement is copied. The import and state validators reject invalid coordinates, cross-row or missing supports, and support cycles. Public snapshots explicitly allowlist the placement data. Reduced-motion preferences disable settling animation. This is constrained placement with transitions, not a general physics engine or a physical-fit guarantee.

## Application layers

| Area | Responsibility |
| --- | --- |
| `app/page.tsx` | Request identity and the application entry point. |
| `components/CybershelfApp.tsx` | Library, shelves, journal, Following, Explore, profiles, and editing flows. |
| `components/ShelfCanvas.tsx` | Responsive shelf rendering and item interaction. |
| `components/DecorArt.tsx` | Built-in SVG decorative objects. |
| `components/AddBooks.tsx` | Metadata lookup, import previews, and uploaded-file intake. |
| `components/BookDetails.tsx` | Sources, reading records, metadata, and book removal. |
| `components/PublicShelf.tsx` | Shared shelf display, saving a title, and copying an arrangement. |
| `components/ProfileView.tsx` / `PublicProfile.tsx` | Private profile preview/publication and public reader page. |
| `components/ReadingJournal.tsx` / `ReadingThread.tsx` | Private reading entries and explicitly shared conversations. |
| `components/FollowingFeed.tsx` / `SpoilerText.tsx` | Following activity, explicit acquisition shares, and accessible spoiler hiding. |
| `lib/use-library.ts` | Account loading, autosave, version conflicts, and guest drafts. |
| `lib/import.ts` / `lib/export.ts` | Bounded imports, backups, originals, and CSV handling. |
| `lib/server/` | Validation, owner checks, storage access, and response helpers. |
| `db/schema.ts` / `drizzle/` | Database schema and immutable schema migrations. |
| `worker/index.ts` | Worker entry point and retained Sites request context. |

The maintained starter includes connector plumbing, but it is unrelated to the native Hardcover browser connector. `lib/connections/hardcover.ts` performs provider OAuth and API calls directly in the browser; `lib/use-connections.ts` holds sessions above the application views. Only whitelisted connection metadata enters `useLibrary`. Retailer and Goodreads live account access is not supplied by the starter plumbing.

## Persistence and saves

Application data is split between private state and deliberate public snapshots:

| Table | Stored data |
| --- | --- |
| `libraries` | One validated JSON state per stable owner ID, a version counter, and update time. |
| `assets` | Private asset owner, type, object key, filename, MIME type, size, and creation time. |
| `publications` | Owner/shelf relationship, sanitized snapshot, public image allowlist, and timestamps. |
| `public_profiles` | One public identity per owner, selected shelf, sanitized profile snapshot, and images. |
| `reading_posts` | Explicit entry snapshot, owner, exact public-profile ID, source book/entry IDs, and images. |
| `reading_comments` | Reply body, marker, author display name/profile, and parent post; deletion cascades from the post. |
| `reading_events` | Retained rolling posting counters so removing a post/reply cannot reset its limit. |
| `follows` | Follower/owner relationships and the last public profile ID. |
| `reader_activity` | Explicit purchased/added announcements containing allowlisted book metadata. |

Better Auth additionally owns `auth_user`, `auth_session`, `auth_account`, `auth_verification`, and `auth_rate_limit`. Password hashes and session tokens stay server-side. The verification table is reserved for the maintained authentication schema; no email delivery or account-recovery flow is configured in this release.

The compact state record keeps the private application state simple and makes catalog backup straightforward. It has a 2 MB payload ceiling, 2,000-book ceiling, and 100-shelf ceiling. A larger-scale version may normalize records, but that migration must preserve IDs, exports, placements, and conflict behavior.

Signed-in saves send the expected version with the complete validated state. The database updates only when that version matches. A stale write receives HTTP 409 rather than overwriting changes from another device. The client stops automatic overwrites, retains its current working copy, and offers export and reload.

Anonymous edits use a clearly labelled browser-local draft. They are not synchronized records. A signed-in account loads D1 state, and a browser draft can be brought into an empty account deliberately.

## API surface

| Endpoint | Access and purpose |
| --- | --- |
| `GET /api/auth/*`, `POST /api/auth/*` | Better Auth session, signup, sign-in, and sign-out endpoints. |
| `GET /api/state` | Signed-in owner: current state, version, and initial display name. |
| `PUT /api/state` | Signed-in owner: atomic versioned save plus revocation of publications for removed shelves and reading entries. |
| `GET /api/assets` | Signed-in owner: uploaded-asset inventory and storage usage. |
| `POST /api/assets` | Signed-in owner: bounded multipart book/image upload. |
| `GET /api/assets/[id]` | Asset owner only: original file or private image. |
| `DELETE /api/assets/[id]` | Asset owner only: removal subject to reference checks. |
| `GET /api/search?q=...` | Bounded metadata search backed by Open Library. |
| `GET /api/book-details?isbn=...` | Cached, bounded edition appearance lookup for a valid ISBN. |
| `GET /api/connections/config` | Signed-in owner: provider availability and optional public application ID; no credentials. |
| `GET /api/reading-room?bookId=...` | Signed-in reader: own/followed shared entries through the selected saved bookmark, ordered and paginated. |
| `GET/POST /api/reading-room/[postId]/comments?bookId=...` | Signed-in reader: protected replies and bounded reply creation within the selected bookmark. |
| `GET /api/publications` | Published shelf snapshots, paginated for Explore. |
| `POST /api/publications` | Signed-in owner: publish/update a snapshot of a saved shelf. |
| `GET /api/publications/[id]` | Read one published snapshot. |
| `DELETE /api/publications/[id]` | Publication owner only: revoke the snapshot. |
| `GET /api/publications/[id]/assets/[assetId]` | Read an image explicitly allowlisted by an existing publication. |
| `GET/POST/DELETE /api/profile` | Owner: inspect, explicitly publish/update, or unpublish the featured profile. |
| `GET /api/profiles/[id]` | Read the current public-profile snapshot. |
| `GET /api/profiles/[id]/assets/[assetId]` | Read an allowlisted profile image while the profile remains published. |
| `GET /api/profiles/[id]/journal` | Public, paginated shared reading entries for this exact profile. |
| `GET/POST /api/journal` | Owner: inspect shared-entry status or explicitly share a saved private entry. |
| `GET/DELETE /api/journal/[id]` | Read a visible conversation; owner may unshare it. |
| `GET /api/journal/[id]/assets/[assetId]` | Allowlisted reading-post image gated by a currently public profile. |
| `POST /api/journal/[id]/comments` | Signed-in reader: create a bounded, progress-marked public reply. |
| `DELETE /api/journal/[id]/comments/[commentId]` | Reply author or conversation owner: remove the reply. |
| `GET/POST /api/follows` | Owner: list follows or follow a public profile. |
| `DELETE /api/follows/[profileId]` | Owner: unfollow a reader, including a now-private profile. |
| `GET /api/feed` | Owner: a stable cursor-paginated stream from followed public readers. |
| `GET/POST /api/activity` | Owner: manage recent explicit book announcements or share a new one. |
| `DELETE /api/activity/[id]` | Owner: remove an explicit book announcement. |

Public shelf, profile, and reading-conversation endpoints allow anonymous visitors. Private data and application mutations require a valid account session. An optional outer access restriction would also restrict share links.

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

## Journals, profiles, and the following feed

Choosing a featured shelf only changes private state. Publishing the profile requires the reviewed shelf ID, name, bio, and shelf timestamp to match saved state; the guarded database write also checks the library version. Profile publication is independent of publishing that shelf to Explore.

A reading entry stores `{id, body, progress, page?, createdAt}` in its private book. Its marker does not change as the book progresses. Existing reviews and notes are never copied into an entry. Sharing reads the saved entry and stores an allowlisted public book plus that entry. A body may be empty for a start/progress/finish milestone. Updating private writing does not change its public snapshot until explicitly re-shared.

Public reading posts join the exact current `public_profiles.id`, not merely the owner ID. Unpublishing hides entries, comments, and images immediately. A new profile does not revive old posts automatically; an owner may deliberately re-share one. Profile-linked replies follow the same rule for their author. Signed-in readers without a published profile may reply under their chosen display name, but those replies do not produce a followed-profile event.

Reply markers must be at least the parent entry’s marker and at most 100%. Effective displayed reply markers cannot fall below an updated parent marker. The author and journey owner may remove replies. The database enforces 100 replies per thread and retained rolling posting limits. Removing an entry deletes its thread/replies. Saving a library and removing posts whose private entries were deleted happens in one D1 batch, with cleanup reading the actual saved state so a stale save cannot revoke a newer tab’s work.

The Following feed unions only currently public shared posts, visible replies from followed public profiles, published shelves, and explicit acquisition announcements. It orders by timestamp plus a stable event key and returns 30 events per page. It does not stream private progress, imported purchases, source locations, or new private shelves. Published shelf updates replace that shelf’s previous feed event rather than creating an unbounded event for each rearrangement. Follows survive a profile becoming private, while the profile and its events disappear; the reader can still remove the follow.

Purchase/addition posts use only public book metadata. They do not expose original files, private asset URLs, retailer links, prices, or physical locations. Their explicit choice distinguishes buying a book from adding a borrowed or wanted title. No email or push delivery is configured.

Spoiler controls compare the declared percentage with saved progress matched by normalized title and author. Unknown/unread titles start protected; public thread/profile views offer local overrides that do not write to the library. Hidden prose is not mounted in the DOM, including for screen readers, until intentionally revealed. The underlying posts are public: these controls are reading aids, not an access boundary or automatic content classifier. Percentages across different editions are approximate.

## Import and backup boundaries

Goodreads CSV parsing handles quoted fields and multiline text. Duplicate detection uses ISBN where present, otherwise normalized title/author matching. Separate known ISBN editions can coexist. Ordinary catalog imports keep existing notes and sources; uploaded-file imports can append new file sources while preserving the existing reading record.

EPUB intake reads its ZIP central directory, then only bounded package metadata and supported cover artwork. Streamed decompression stops when an output limit is exceeded. XML custom entities are rejected. The app does not execute EPUB content or render a full EPUB reader. Metadata failure returns an editable fallback while preserving the original-file workflow.

The complete backup uses ordinary, uncompressed ZIP entries so the file bytes remain unchanged. `catalog.json` holds the account state; `manifest.json` maps private asset IDs to original files in the archive. JSON import removes old publication identities. It retains private journal entries, physical metadata, and the featured-shelf choice, but never restores public post/profile identities, follows, or replies. Restoring elsewhere requires uploading originals and replacing the old private asset references; the server does not treat a backup as permission to access another account.

## Identity and hosting

[`app/auth.ts`](../app/auth.ts) resolves a signed cookie through Better Auth and D1. The stable account ID is the ownership key. Cookies are HTTP-only, SameSite=Lax, and Secure on HTTPS. Sessions expire after 30 days and are checked against D1; the session cookie cache is disabled. Sign-out is a POST and revokes the session. The application never accepts `oai-authenticated-*` headers as proof of identity.

[`lib/server/auth.ts`](../lib/server/auth.ts) configures an explicit `APP_ORIGIN`, a required random `BETTER_AUTH_SECRET`, maintained password hashing, and database-backed rate limits. Cloudflare’s `CF-Connecting-IP` supplies the rate-limit address; forwarding headers chosen by a caller do not establish identity. Accounts have unverified email addresses until an actual verification flow is added. Account linking is disabled. A missing auth configuration disables account sign-in while keeping guest browsing available.

Private mutation requests carry `X-Cybershelf-Account` as an identity precondition. The server compares it with the authenticated session; the header cannot grant access. This prevents an old tab from saving one reader’s library into another reader’s account after a cookie/session change. Optimistic library versions separately prevent concurrent overwrite within the same account.

Public snapshots use the chosen profile display name and do not fall back to publishing an email address. Moving records from another deployment or identity provider requires a verified mapping of old and new owners; raw ownership IDs do not transfer access.

The root `wrangler.jsonc` owns the production Worker name, bindings, canonical origin, and custom domain. Its D1 UUID is a resource identifier, not a credential. The build derives `dist/server/wrangler.json`; deployments use that generated file. `scripts/deploy-cloudflare.mjs` applies only pending D1 migrations before uploading the Worker and stops if a migration fails. Request handlers never create tables. Local and integration-test storage is separate from production.

The retained `.openai/hosting.json` records the original development Site identity. It does not configure authentication for this standalone release and is not the destination of `pnpm run deploy`.

## External requests and future work

Metadata search sends the query to Open Library. External cover URLs load from their respective hosts. Platform source links navigate to those services; they do not establish linked-account access or file export rights.

Further account connectors, OPDS support, synchronization across reader devices, standalone public reviews, richer physical fit planning, and notification delivery should be separate additions with visible capability boundaries. They are not supplied by the social journal or visual shelf geometry.

## Reading rooms and account sync in v0.4

`reading_posts.book_key` is an indexed normalized title/author key. Newly shared entries write it immediately. Existing shared entries are indexed with the same JavaScript Unicode normalization in bounded batches; a retryable preparation response is preferable to an incomplete conversation. This adds no private library text to a public record.

Room requests resolve the authenticated reader’s selected book from the saved library. The selected copy alone supplies the ceiling, so a finished edition elsewhere in the library cannot unlock a reread. The SQL query includes only currently public profiles from followed owners or the reader themselves. Later bodies are not serialized. Counts and replies use the same ceiling, including a parent entry’s effective marker. Cursor context includes the book, ordering, and ceiling; changed progress cannot reuse a higher cursor. Replies recheck library version, parent revision, follow membership, and current profile in the atomic insert.

The room UI clears stale views when permission checks fail and expires expanded replies when its parent refreshes. It uses its own protected routes; the existing public conversation pages and feed retain their separate deliberate-reveal controls. Shared posts remain public data even though a reader’s room selects a safe subset.

Hardcover credentials live only in an opaque browser session. Pending OAuth state/verifier is account-bound and short-lived; token exchange, library calls, refresh rotation, and revocation never pass through Cybershelf. The callback has `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`. The optional public client ID is read from Worker runtime configuration.

Connection sync applies an explicit field allowlist, with the last accepted values used as a three-way baseline. Local edits win conflicts; reading status and progress move together only when enabled and sufficiently specified. Removing a provider record never removes the local book. Imported metadata, preferences, and matching fingerprints are stored in D1; provider credentials are not. This protects credential handling in the current implementation, not against operator-readable metadata or altered future JavaScript. See [account connections](account-connections.md) for exact setup and the threat boundary.
