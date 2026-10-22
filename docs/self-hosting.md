# Deploying cybershelf to Cloudflare

This release runs independently in your Cloudflare account. GitHub stores the source; Cloudflare Workers runs the application, D1 stores accounts and libraries, and private R2 stores uploaded files. GitHub Pages cannot run the authenticated server APIs.

## Configuration already in this repository

The root `wrangler.jsonc` contains:

| Setting | Value |
| --- | --- |
| Worker name | `cybershelf` |
| D1 database | `cybershelf-db` |
| D1 database ID | `1aeda0cc-2045-471d-842f-b0423e43b848` |
| D1 binding | `DB` |
| R2 bucket | `cybershelf-files` |
| R2 binding | `BUCKET` |
| Application origin | `https://cybershelf.io` |
| Custom domain | `cybershelf.io` |

These resources must belong to the account used for deployment. The database ID is a normal resource identifier, not an API key. Keep the bucket private; do not enable public R2 access for original books. The Worker handles authenticated downloads and the limited image access needed by public shelf snapshots.

If you fork the project, create your own database and bucket and replace these values, including the domain. Do not reuse the maintainer's resources or the retained development Site identity.

## 1. Connect GitHub to Workers Builds

In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages → Create application → Connect GitHub**, select `ahmidii/cybershelf`, and use:

| Build setting | Value |
| --- | --- |
| Worker/project name | `cybershelf` |
| Production branch | `main` |
| Root directory | Repository root (`/`) |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy` |
| Build variable `NODE_VERSION` | `24` |
| Build variable `PNPM_VERSION` | `11.25.0` |

Cloudflare installs dependencies before the build. The committed package-manager version and lockfile should be used. An existing Worker can connect under **Settings → Builds → Connect** instead of creating another Worker.

The current configuration points at the production database. Enable automatic deployment for `main`; do not configure branch previews against these same production bindings. A separate preview environment needs its own database, bucket, secret, origin, and deployment configuration.

The build writes `dist/server/wrangler.json` and the client assets. The deploy command first applies pending SQL migrations from `drizzle/`, then deploys that built configuration. A failed migration stops deployment. Wrangler tracks successful migrations, so retrying a failed build does not blindly rerun all SQL.

Reference: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [build image settings](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).

## 2. Give the build token permission to apply migrations

Cloudflare's automatically generated build token does not currently include D1 write permission. The deploy script needs it to create and update the application's tables.

1. In **cybershelf → Settings → Builds → API token**, identify the selected token.
2. Open **My Profile → API Tokens**, edit that token, and add **Account → D1 → Edit** for the account containing `cybershelf-db`.
3. Keep its existing Worker, R2, account, and zone permissions. Save the token and retry the deployment.

If you use a separately created token, select it in the Worker's build settings with the normal Worker deployment permissions plus D1 Edit. You do not need to put the token in GitHub source or share it in chat.

Reference: [Workers Builds API-token permissions](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), and [Worker authorization](https://developers.cloudflare.com/workers/authorization/).

## 3. Authentication secret and runtime settings

`pnpm run deploy` now initializes a missing authentication key after publishing the Worker. It checks the deployed Worker's secret names, preserves an existing encrypted `BETTER_AUTH_SECRET`, and also preserves a working legacy runtime key. If the key is absent, it promotes a valid build-only `BETTER_AUTH_SECRET` when supplied, or generates 48 cryptographically random bytes. The value is passed to Wrangler through stdin, kept out of command arguments/output/files, and stored as an encrypted Worker secret. Private secret commands disable Wrangler's debug-file logging.

Deployments preserve optional dashboard variables through `--keep-vars`; source-controlled values such as `APP_ORIGIN` still take precedence. The final read-only `/api/health` check reports only whether account and email configuration is available. It does not reveal secrets, users, or database records, and it does not prove inbox delivery or a full signup transaction.

Keep the first deployment sequential: first-time key initialization is a check followed by a write, not an atomic create-only operation. Normal subsequent builds preserve the configured key. If the status check, secret-list permission, or secret upload fails, deployment reports that failure rather than printing private diagnostics or silently replacing an existing key. An existing short/invalid secret is deliberately left for the owner to repair.

To configure or repair the key manually:

Open **Workers & Pages → cybershelf → Settings → Variables and Secrets → Add**:

| Field | Value |
| --- | --- |
| Type | **Secret** |
| Name | `BETTER_AUTH_SECRET` |
| Value | A unique cryptographically random value, at least 32 characters |

Generate it locally with your password manager, or with Node:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Store that result privately and paste it into Cloudflare. Choose **Deploy** when saving the secret. It is a Worker runtime secret, not a public `VITE_` variable. Keep the same value across future deployments; changing it invalidates existing sessions. If moving an existing plaintext key to an encrypted binding, retain its value rather than generating a replacement.

`APP_ORIGIN=https://cybershelf.io` is already in the source configuration. Wrangler preserves previously configured secrets on deployment. Without a valid secret, the guest app can load but account creation and sign-in remain unavailable.

Reference: [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Wrangler deployment options](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

## 4. Confirm the custom domain

The committed custom-domain route tells deployment to connect `cybershelf.io`. Cloudflare manages the DNS record and certificate when the zone is active in the same account and there is no conflicting record.

After a successful deploy, check **cybershelf → Settings → Domains & Routes** for `cybershelf.io`. If Cloudflare reports a conflicting DNS record, inspect the exact record it names and resolve that conflict before retrying. Do not change unrelated mail or DNS records. An existing conflicting CNAME cannot be used for a Worker Custom Domain.

Use **https://cybershelf.io** for account tests. Authentication deliberately trusts this exact configured origin. A temporary `workers.dev` URL is not an alternative sign-in origin. To change the primary domain later, update `APP_ORIGIN` and the custom-domain route together, then rebuild and deploy.

`www.cybershelf.io` is not configured. If you want it, add a separate redirect to the canonical `https://cybershelf.io` address rather than treating the two hosts as interchangeable sessions.

Reference: [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## 5. Verify the deployed application

Open the custom domain, create an account, add a book and a shelf, and reload to confirm they persist. Upload a small EPUB/PDF and retrieve it through **Grab this book**. Sign out and sign back in. Publish a shelf and open its share link in a signed-out window; that link should show the chosen shelf without private notes, source links, or book originals.

If a private API reports a database error, check that all seven committed migrations completed successfully. If authentication is unavailable, check the runtime secret and exact origin. If requests fail with a Worker CPU-limit error, inspect Cloudflare's invocation metrics and plan limits. The Free plan has a small per-request CPU allowance; a local test does not establish that a complete production auth request fits it. The maintained authentication dependency uses native scrypt on Workers, without reducing password-hash strength to meet a plan limit.

Reference: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## 6. Enable account email

Basic accounts do not require a mail provider. Password recovery and confirmation use [Resend](https://resend.com/docs/send-with-cloudflare-workers), which requires an API key and a verified sending domain.

1. Add `cybershelf.io` (or your own domain in a fork) in Resend's Domains dashboard. Add the exact DNS records Resend supplies in Cloudflare, and wait for its verified status. Do not overwrite unrelated existing mail records.
2. Create an API key with sending access to that domain. Keep it private; it does not belong in GitHub, screenshots, or chat.
3. In **Workers & Pages → cybershelf → Settings → Variables and Secrets**, add:

   | Name | Type | Value |
   | --- | --- | --- |
   | `RESEND_API_KEY` | Secret | The sending API key from Resend |
   | `AUTH_EMAIL_FROM` | Text | `cybershelf <accounts@cybershelf.io>` |

4. Choose **Deploy** to apply the runtime settings. These settings survive later GitHub deployments. A syntax-valid configuration enables the UI; it cannot establish whether the provider has verified the sender or will deliver to a particular inbox.
5. With your own account, use **Account & security → Send verification link** and confirm the message. Then request a reset for your own address and check inbox/spam delivery. Never use another reader's email as a deployment test.

The app sends a confirmation link on signup after email is enabled. Confirmation remains optional for sign-in so existing readers are not locked out. Email confirmation does not create a session or switch the current account. Password reset links expire after one hour, can only be used once, and revoke existing sessions; the reader signs in again with the new password. Verification links expire after 24 hours.

Reset requests use the same response for known and unknown addresses. Provider delivery errors are logged as a fixed message without addresses, tokens, keys, or provider payloads. Messages run through the Worker's `waitUntil` lifecycle. Auth/recovery pages use no-store, no-referrer, and noindex protections. `email: true` in `/api/health` means the two settings are syntactically ready, not that a message reached an inbox.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [Resend API](https://resend.com/docs/api-reference/emails/send-email), and [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Account behavior and current limits

Accounts use Better Auth, signed HTTP-only cookies, database-backed sessions, and database-backed authentication rate limits. Sign-out is a POST. Raw identity headers cannot authenticate a request. A separate account precondition prevents an old tab from saving into another account after a session switch.

This release supports email/password signup and sign-in without an external email service. The account page supports password changes and signing out other devices. Password changes require the current password and revoke other sessions; an older session can sign in again through the explicit reauthentication flow. Automatic account linking and email-address changes remain disabled.

**Production email remains an owner activation step.** Until the provider settings above are present, the interface says verification/recovery are unavailable. Do not advertise delivered recovery email until your own inbox test passes. Browser-draft imports preserve the account name, and failed library saves offer an export or explicit discard before signout.

The application limits in the README still apply. Keep backups of both D1 and R2: a database backup has file references, not the uploaded bytes. Password/session records are sensitive and should not be included in public debugging output.

## Local development and CLI deployment

Follow the [README](../README.md#run-locally) for local setup. Development uses `.wrangler/state` and the ignored `.dev.vars` file; it never needs a production API token. Normal sign-up and sign-in also work locally.

For a CLI deployment from your own machine:

```sh
pnpm exec wrangler login
pnpm run build
pnpm run deploy -- --dry-run
pnpm run deploy
```

The final command applies remote migrations and publishes to the account you authenticated. Review the resource identifiers before using it in a fork. Add the runtime secret through the dashboard or `pnpm exec wrangler secret put BETTER_AUTH_SECRET --config wrangler.jsonc`.

Schema updates belong in new, committed migrations. Do not edit a migration that has already run in production or reinitialize storage after an error. If a migration succeeds but the Worker upload fails, retry the deployment; completed migrations remain tracked.

## Moving an existing collection

Export JSON and original files from the original account first. Restoring JSON to the same deployment/account reconnects uploads that still exist there. Moving to a different deployment or account currently requires re-uploading originals and replacing old private asset references. A ZIP export contains the unchanged originals and an asset manifest, but one-step ZIP restore is not implemented.

Old Sites account IDs and new standalone account IDs are different ownership keys. Do not copy records between identities without an explicit verified mapping. Published snapshots should be created again from the restored library.

The original `.openai/hosting.json` is retained for development history. The standalone `deploy` command does not publish to that Site or depend on its authentication boundary.

## Optional book account connections

Version 0.4 includes a browser-only Hardcover connector. Enable it once for your installation with a public OAuth application ID in the Worker runtime. No client secret, additional database, or background worker is needed. Follow [the account connection setup guide](account-connections.md#activate-hardcover-on-your-installation) for the exact callback, scopes, and `HARDCOVER_CLIENT_ID` setting. This is separate from Cybershelf’s own email/password sign-in and from a Cloudflare deployment API token.
