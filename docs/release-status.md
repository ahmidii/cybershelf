# Release status — 0.1.0

Updated 2026-10-22.

## Source and destination

The first release is implemented and its source is published in the public [ahmidii/cybershelf](https://github.com/ahmidii/cybershelf) repository. The repository contains the complete application, maintained test commands, database migration, MIT license, and setup documentation. Future updates can be made through this repository.

The intended domain is `cybershelf.io`, owned by the project maintainer on Cloudflare. The registered Sites deployment has not been published, and the domain has not been connected to it. Owning the domain and storing the code on GitHub do not by themselves deploy the application.

## Verified for this package

- TypeScript validation completed successfully.
- The complete regression suite passed: 24 tests, no failures or skipped tests.
- The production Vinext build completed successfully for the application, public shelf pages, and seven API route patterns.
- The committed initial database migration is `drizzle/0000_awesome_zarda.sql`.
- Authored source was checked for accidental credentials and local runtime files before packaging. Dependencies, build output, local databases, caches, and environment files are excluded from the archive.

Regression coverage includes Goodreads CSV handling, original-file attachment to existing books, import/export round trips, ZIP byte preservation, shelf-arrangement invariants, strict state validation, and public/private field separation.

The package restores two fixes from the interrupted release preparation: imported originals are retained when a catalog entry already exists, and shelf deletion cleans publication records without an oversized database query. Shelf duplication also keeps long titles within the server limit.

## Verification still pending

Browser-based visual, responsive, and keyboard-interaction QA is incomplete because the preview browser was unavailable. The source includes responsive layouts and accessible placement controls; that does not establish that visual QA passed.

The local API integration script remains available at `lib/server/integration.test.mjs`. It was not rerun as part of this replacement-archive build. A live authentication and storage smoke test is required after a successful deployment.

## Deployment requirements

The current application uses Sites authentication, Cloudflare Workers, D1, and private R2 storage. GitHub Pages alone cannot run its authenticated server routes. Publishing through the existing Sites project is still pending a source-publication access issue in the build environment. Keep the registered project ID in `.openai/hosting.json` when resuming that deployment.

An independent deployment in the maintainer's own Cloudflare account requires a real authentication adapter and resource configuration; see [self-hosting](self-hosting.md). Do not treat raw client-supplied identity headers as authentication.

Once a host is published, connect `cybershelf.io` using that host's exact returned DNS records and verify HTTPS and sign-in on the custom domain. No DNS target is assumed by this source release.

## Product boundaries

Goodreads support is CSV import. Retailer sources are saved links. There is no automatic purchase sync, cross-reader progress sync, DRM removal, OPDS endpoint, or full EPUB reader in this release. Reviews and reading journal data are private; public pages contain explicitly published shelf snapshots. ZIP export includes original uploads, but full cross-account ZIP restore is not implemented as a single operation.

See [README](../README.md) for the features, local setup, limits, backup behavior, and license.
