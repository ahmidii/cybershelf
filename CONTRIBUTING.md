# Contributing to cybershelf

Thanks for helping make a thoughtful home for books. The most useful changes make collecting, arranging, finding, or sharing a book easier to understand.

## Product principles

- **A catalog is not a purchase receipt.** Never infer ownership from a reading status, shelf placement, imported title, or review.
- **A shelf is an arrangement of library entries.** Removing a placement must retain the book. Removing a library book must remove its placements deliberately.
- **Personal expression needs predictable controls.** Preserve pinned objects, empty space, and staged items when sorting. Keep preview, cancel, and undo behavior understandable.
- **Private means private at the API boundary.** Public snapshots must use an explicit field allowlist. Tests should prove that book files, source links, notes, reviews, progress, and staged content cannot leak through publication endpoints.
- **Portability is a working feature.** Preserve original bytes and make exports useful outside cybershelf. Do not promise a connection, reader feature, or synchronization path that the implementation does not provide.

## Local work

Follow the [README](README.md#run-locally) for installation and local migrations. Use the committed lockfile and pinned package manager. Keep changes focused, and leave Sites integration files intact unless the change specifically concerns hosting.

Do not commit real libraries, uploaded books, private notes, credentials, `.env` files, `.dev.vars`, `.wrangler`, `.sites-runtime`, or generated `dist` output. Use synthetic fixtures or public-domain material when testing file handling. Source control must include schema migrations and their Drizzle metadata.

Schema changes belong in `db/schema.ts`. Generate a new migration with `pnpm run db:generate`, inspect the SQL, and apply it once to a local preview. Do not rewrite migrations that may already have run in a deployed database. Do not create or alter tables inside request handlers.

## What to verify

Choose checks that address the changed behavior:

- Catalog and import changes: quoted CSV fields, duplicate editions, source attachment, existing notes, malformed input, and round-trip backup behavior.
- Shelf changes: keyboard and touch controls, pinned items, gaps, undo, smaller-layout overflow, and a narrow mobile viewport.
- Sharing or file changes: signed-out access, a second account, revocation, uploaded image access, and original-book isolation.
- Save changes: optimistic version conflicts, visible retry states, and retaining unsaved work for export.

Build the project after changes. The targeted tests are documented in the README. Integration fixtures must run only against a local preview, never a production site. Avoid tests that merely repeat implementation details; exercise outcomes that matter to a reader.

## Accessibility and presentation

The interface should remain usable without dragging. Keep the select-and-move controls, labelled buttons, visible focus, dialog dismissal, and readable status messages. Do not make color the only way to identify a status or selection. Check both light shelf finishes and Ink, and respect reduced-motion preferences when adding animation.

Keep the brand quiet: readable text, restrained monospace labels, warm materials, and space for the user's books. New decoration assets should have a clear license and remain recognisable at shelf size. A user-uploaded image is not automatically reusable artwork for someone else's shelf.

## Proposing a change

In a pull request, explain the reader-facing problem, the resulting behavior, and the checks you performed. Add screenshots for a meaningful visual change. Discuss new external services, identity providers, or account integrations before committing to their architecture. Use the project's [issues](https://github.com/ahmidii/cybershelf/issues) and [pull requests](https://github.com/ahmidii/cybershelf/pulls) to propose and review changes.

If you discover a privacy issue, describe it without including credentials, another person's records, or private file links in a public issue. Preserve a minimal synthetic reproduction for maintainers. Do not test against other people's accounts.

Contributions to original cybershelf code are made under the repository's MIT license. Preserve existing third-party notices and identify the source and license of any added asset.
