# Hosting cybershelf

The repository contains the application, server routes, schema, and source-level hosting configuration. The current release is integrated with ChatGPT Sites. An independent deployment needs additional authentication and deployment configuration; it is not a one-click self-hosting package yet.

## Current runtime

- Vinext renders the React application and server routes.
- A Cloudflare Worker runs the server.
- D1 holds private catalog state, uploaded-file metadata, and publication snapshots.
- R2 holds uploaded originals and images.
- Sites supplies trusted request identity, sign-in/sign-out routing, the deployment audience, and provisioned bindings.

GitHub can host the source and collaboration workflow. GitHub Pages alone cannot run this release's authenticated APIs, database writes, or private file handlers. Keep source hosting and application hosting as separate choices.

## Updating the existing Sites deployment

Use the Sites workflow from the repository checkout. Preserve `.openai/hosting.json`, its existing `project_id`, the Worker integration, and logical `DB`/`BUCKET` bindings. Use the project's maintained install/build helpers, generate migrations before building, and publish the verified matching source version and artifact.

The hosting manifest contains deployment identity and logical binding names, not production database IDs or credentials. Do not replace it with private resource identifiers merely to run local development. Do not commit runtime credentials, `.dev.vars`, or `.env` files.

New deployments or forks need their own registered identity and storage. Reusing the existing Site ID does not create an independent fork and should not be used to publish someone else's deployment.

## Local development

Start from the [README setup](../README.md#run-locally). A clean clone has no checkout-local execution-profile file and uses the portable profile. Install with the pinned package manager and its committed lockfile. The tracked scripts select the appropriate framework behavior; the managed Linux profile additionally relies on the Sites workspace tools.

Build once to emit `dist/server/wrangler.json`, then apply each pending SQL migration to the local D1 database. The persistence directory is `.wrangler/state`; do not add its internal version suffix yourself. Use one local preview owner at a time.

The portable development integration can simulate a test user on loopback requests. That mock sign-in is for local development only. Managed previews do not add it, and production builds must not depend on it. Do not expose a development preview as a public service.

## Independent deployment checklist

### 1. Supply real authentication

Replace or adapt `app/chatgpt-auth.ts` and the sign-in links. The application needs a verified, stable user ID, an optional display name, and account-session handling. Choose a normal authenticated session implementation for the target host, or place the Worker behind a trusted identity proxy.

If using a proxy, strip all incoming `oai-authenticated-*` headers before authenticating the request, then inject verified identity server-side. Block direct access to the origin so a visitor cannot bypass that proxy. A frontend-supplied user ID, a query parameter, or a freely writable request header is not authentication.

Sites owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback` in its deployment. Those routes do not become a working OAuth integration when the source is deployed elsewhere. Replace the route/link behavior as part of the adapter. Keep private APIs rejecting unauthenticated requests and preserve account-owner checks for every original-file operation.

User IDs are deployment-specific ownership keys. Moving raw D1 records to another identity provider requires a verified owner mapping. JSON/catalog import is an alternative for an individual reader, but old private file references must be replaced with that account's new uploads.

### 2. Provision database and object storage

Create a D1 database and private R2 bucket for the independent deployment. Bind them as `DB` and `BUCKET`, or update the relevant source/environment typings together if using different names. Keep the R2 bucket private and route file access through the application.

Configure the target's Worker deployment settings and compatibility requirements using the generated build and the retained `worker/index.ts` entry point. The repository's Sites-generated configuration is not a ready-made configuration for arbitrary external accounts. Production resource IDs belong in the target deployment configuration, and secrets belong in that host's secret store.

Apply committed schema migrations in order. Track which migrations have run, including after a partially failed deployment. Back up the database before changing an existing deployment's schema. Never reinitialize storage as a workaround for a migration error.

### 3. Verify the account boundary

Before opening the independent deployment to readers, verify the concrete behavior with your authentication adapter:

- A signed-out request cannot read or write a library or retrieve an original.
- A second account cannot retrieve, attach, delete, or publish the first account's private assets.
- A publication contains only its allowlisted fields and permitted image objects.
- A book original cannot be served through a public image path.
- Revoking a publication removes its snapshot and image access.
- A stale save returns a conflict instead of replacing a newer state.

The local integration tests cover these application expectations. They deliberately accept only a loopback target. For an independent deployed environment, verify its real authentication mechanism separately; manually adding identity headers is not a production sign-in test.

### 4. Configure audience, limits, and operations

If public shelf links should be readable by anyone, the outer hosting audience must allow anonymous requests to public pages and endpoints. The application still requires authentication for private data and mutations. Setting the entire host private also restricts shared shelf URLs.

Review the implemented first-release limits in the README and source before changing them. File storage, Worker memory, database payloads, and browser backup memory impose different constraints. A larger per-file limit is not sufficient to support larger libraries safely.

Maintain backups of both D1 and R2 if operating the service. A database-only backup contains object references, not original files. Logs should help diagnose failures without dumping private catalog content or credentials. Choose a retention/deletion policy before inviting a wider community; uploaded objects and catalog entries are separate records.

## Moving a personal collection

On the original deployment, export the catalog JSON and a complete ZIP when the collection fits the 100 MB archive limit. For larger collections, export JSON and download originals individually. The ZIP includes an asset manifest and unchanged originals.

Restoring JSON to the same account reconnects uploads that still exist there. Restoring a collection to another account or deployment currently requires re-uploading the files and replacing old private asset references before saving the restored catalog. Unpacking and restoring a ZIP as one operation is not implemented. Published snapshot identities are intentionally removed from imported JSON; share the restored shelves afresh when ready.

Retailer purchases and external cover URLs are not copied into the archive. Their catalog links are preserved, and access remains controlled by their original service or owner.

## Custom domain

`cybershelf.io` is the project's intended custom domain. The source does not itself register, verify, or activate it. Add the domain through the selected host and apply the exact DNS records returned by that host. Confirm certificate issuance, HTTPS routing, the canonical hostname, sign-in return paths, and existing share URLs before advertising the domain as live.

Do not invent a CNAME target or change unrelated DNS records. Domain configuration and GitHub repository selection are deployment tasks outside the application source.
