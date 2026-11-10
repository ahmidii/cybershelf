# Shared decorations and book artwork

Version 0.9 uses one catalogue and permission model for reusable decorations, book spines, and covers. The 100 bundled decorations are trusted, versioned CC0 assets from Kenney and KayKit. Community input is persisted in D1 and independent R2 objects; it is not stored only in a browser or on the contributor's shelf.

## Reader experience

Open **Decorate** to search titles/tags, filter categories, and inspect an item before adding it. Images are transparent, have sensible display sizes, and use the existing shelf placement engine. Resize and flip controls preserve the same geometry used by the drag preview. Tapping a shared decoration on a public shelf opens its credits and a route to reuse it.

For a book, select the actual edition or provide its ISBN, then open its appearance controls. **Community artwork** shows matching approved spines and covers, including alternate printings. With automatic artwork enabled, an unambiguous matching spine fills the typographic fallback. Existing personal photos and explicit selections are preserved. Covers fill an empty cover automatically; replacing an existing cover is an explicit choice. Edition changes discard artwork that belonged to the previous edition. Automatic checks happen while the library is open, on focus, and after contribution reviews; they are not a background push service.

A spine match requires a verified edition/ISBN, not just a title or a work identity. Equivalent ISBN-10/ISBN-13 values match. Contradictory edition, work, or ISBN values do not. An ISBN may cover more than one printing, so multiple approved variants remain choices instead of silently selecting the latest upload. This cannot guarantee coverage for every book or printing.

## Deliberate contribution

1. Upload an image for personal use. Personal use works immediately and remains independent of contribution review.
2. Choose to contribute the decoration, spine, or cover. Provide its title, public creator credit, source and permission; book artwork also includes edition information and an optional printing/variant label.
3. Explicitly confirm permission and the contribution terms. Both confirmations start unchecked.
4. The server copies the owned upload into independent shared storage, strips supported image metadata, and records a pending submission. Another reader cannot retrieve pending artwork.
5. A configured moderator reviews it. Approved artwork becomes searchable and reusable through the same catalogue API as the starter assets.

The contributor can see status and withdraw artwork from **My contributions** at `/community-contributions#my-contributions`. Withdrawal disables the shared image route for every shelf that references it and queues durable byte cleanup, while preserving the contributor's separate private original. Existing browsers or third parties may already have saved copies; the service cannot recall those copies.

Approved contributions may remain after account deletion, with their chosen public creator credit and without the contributor's account link. This is disclosed at submission and deletion. Withdraw them first if their shared copies should also be removed. Pending and other unapproved copies are erased with the account. Moderation restrictions survive contributor deletion.

The contribution permission applies to operating and displaying this service. It does not claim ownership of underlying publisher artwork. Decoration contributors may select CC0 or CC BY 4.0 only when they can grant that license; book artwork uses the separate community permission. Application source licensing does not change image rights. The in-app terms at `/community-contributions` are the user-facing record of this permission.

## Storage and API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/community-assets` | Search public approved assets and bundled objects; bounded pagination and kind/category/origin filters. `mine=true` shows the signed-in owner's contributions. |
| `GET /api/community-assets/:id` | Public approved details, or the owner's/moderator's permitted pending details. |
| `GET /api/community-assets/:id/image` | Canonical revocable image route; curated thumbnails use `?size=thumb`. |
| `POST /api/community-assets` | Explicitly contribute an owned upload after identity, origin, consent, quota, image, and edition checks. |
| `DELETE /api/community-assets/:id` | Contributor withdrawal. |
| `POST /api/community-assets/resolve` | Match a bounded list of edition identities against approved artwork. No title guessing or external request occurs in this resolver. |
| `GET /api/community-assets/moderation` | Allowlisted moderator's pending/reviewed submissions. |
| `POST /api/community-assets/:id/review` | Freshly authenticated approval, rejection, or withdrawal with a recorded note. Self-approval is refused. |

`lib/shared-assets.ts` owns the common public shape. `lib/decor-catalogue.ts` supplies the versioned starter records; these do not need redundant D1 rows. Community submissions use `community_assets`, `community_asset_editions`, and `community_asset_reviews`. The additive migration is `0009_shared_assets`.

Book and shelf state store shared IDs and canonical image paths, not another owner's private upload ID. Public responses exclude original filenames, private source IDs, object keys, and contributor account IDs. Credits are public by choice. Image serving checks current approval, withdrawal, hiding, suspension, and signed-in blocking both before and after fetching bytes. A withdrawn item cannot be restored merely by restoring a moderation hiding flag.

The original uploaded file is not modified. The separate shared PNG/JPEG/WebP copy is structurally validated and bounded in dimensions and bytes. Camera, location, text, and embedded-thumbnail metadata are removed; a minimal orientation marker is reconstructed when needed for correct display. Animated images are rejected. This sanitization does not remove identifying details visibly present in the picture; preview and crop personal material before contributing. Source URLs are stored as credits and are never fetched by the contribution endpoint.

Independent copied bytes count against the contributor's existing 500 MiB/1,000-file quota along with private assets, active reservations, and cleanup. Submission limits are 20 per day and 40 pending per account. Atomic reservations and finalization recheck account state. Repeated identical submissions by the same contributor/kind/edition are idempotent. Images share the existing bounded upload-buffer concurrency limiter.

The client keeps a full artwork-selection snapshot with an asynchronous lookup. A delayed response cannot overwrite an intervening personal choice. Incomplete/truncated resolver results cannot prove that an existing selection was withdrawn and therefore do not clear it.

## Moderation and recovery

The existing `/moderation` page includes contribution review. Configure actual Cybershelf account IDs in `MODERATOR_USER_IDS`; there is no implicit administrator and no automatic approval. A reader's private artwork works while review is pending. Public shared artwork can be reported through the existing safety flow; hiding and restore apply to its catalogue and image route.

Approved copies are included in the original-file backup scan even after their contributor account is detached. Current `community_asset_erasures`, current catalogue status, and current hiding/suspension evidence must be reconciled before an older database or file copy is restored. A copy in a backup is not permission to make the image public again. See [original backups](original-backups.md) and [production operations](production-operations.md).

JSON/CSV exports preserve supported shared references and preferences. A personal ZIP contains referenced private originals, not every shared image in the catalogue. A different installation must import its own properly licensed catalogue or contributions; a shared ID alone does not move bytes or confer rights.

## Source maintenance

The starter assets are prepared transparent renders, not a live external asset-search API. Their seven source packs, retained license files, archive/model/image hashes, and reproducible Blender/Pillow workflow are documented in [decoration sources](decor-asset-sources.md). No API key or runtime 3D renderer is required. Additional source integrations should preserve creator, license, and provenance per asset and review redistribution permission before publication.
