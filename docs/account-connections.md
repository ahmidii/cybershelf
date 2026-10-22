# Account connections

Cybershelf v0.4 introduces a **Hardcover connection** that brings books into your library and checks for changes while you use the app. The connection uses Hardcover’s own sign-in and consent screen. Readers never give Cybershelf their Hardcover password or paste an API token.

Goodreads CSV import remains available. Other providers in the comparison below are future integration options, not active connections in this release.

Provider capabilities were checked on **22 October 2026**.

## For readers

Open **Connections**, choose Hardcover, and approve the requested permissions on Hardcover. Back in Cybershelf, review the import, give the connection a name, and choose its options before adding the books.

The connection can bring in book titles, authors, covers, selected-edition ISBNs and page counts, ratings, and whether you marked a book as owned. Each imported book gets a link back to Hardcover. A Hardcover ownership flag records what you marked there; it does not verify a retailer purchase or provide an ebook file.

Two options control what happens next:

- **Keep up while I’m here** is on by default. Cybershelf checks for changes about every five minutes while the app is open and visible. You can also sync manually.
- **Bring my reading progress, too** is off by default. Turning it on imports status and available progress. This can reveal later thoughts in Reading together, so your existing bookmark stays independent unless you opt in.

Sync runs **from Hardcover into Cybershelf**. This release does not write changes back to Hardcover or synchronize other services through it. Private notes, reviews, reading journals, email addresses, and social connections are not imported by the Hardcover connector. Importing a book does not publish a post or announce a purchase.

### Reconnecting and disconnecting

The provider session lives in browser memory. Moving between Cybershelf’s views keeps it active; closing or reloading the app discards its credentials. Your imported books and connection preferences remain saved, and **Reconnect** starts another authorized session. This design supports automatic checks during a visit, rather than unattended synchronization after the app closes.

**Disconnect** removes the connection while keeping your books, shelf arrangements, source links, files, and journal. When an active session is available, Cybershelf also asks Hardcover to revoke its credentials. You can revoke the full grant at any time in [Hardcover’s Authorized Apps](https://hardcover.app/account/api/authorized-apps), including after closing the app or if a network error prevented revocation.

## How changes are merged

Cybershelf first looks for an existing connection record, then an unambiguous matching ISBN. A conservative title-and-author match can be used when an edition identifier is missing. Conflicting ISBNs and ambiguous matches stay separate.

On the first import, existing books keep their filled-in details. Later imports compare three values: the last value accepted from Hardcover, the current Hardcover value, and the current Cybershelf value. A provider update is accepted while the local field still matches the previous imported value. If you changed the field yourself, your edit is preserved.

Status and progress are treated as one bookmark. A local reading change or journal entry protects an existing bookmark from being replaced during the initial connection. Later changes also preserve locally edited bookmarks. Progress is calculated only when the provider supplies a usable total for the relevant reading edition, or marks the book read; a different edition’s catalog page count is not treated as an exact reading position.

Removing a book from Hardcover does not delete it from Cybershelf. A failed or incomplete provider request does not apply a partial import. The connection supports up to 2,000 books, subject to the existing 2,000-book Cybershelf library limit.

## Activate Hardcover on your installation

The application code is included in v0.4, but each installation needs its own registered Hardcover OAuth application. This is a one-time setup for the site owner; readers do not create developer applications.

### 1. Register the application

Open [New Developer App on Hardcover](https://hardcover.app/account/developer-apps/new) and use these settings for the production site:

| Setting | Value |
| --- | --- |
| Application type | **Single-page app** |
| Name | **Cybershelf** |
| Website URL | `https://cybershelf.io` |
| OAuth Redirect URI | `https://cybershelf.io/connect/hardcover` |
| Device Authorization Grant | **Off** |
| Allowed scopes | `read:catalog:data read:library read:me:content` |

The redirect URI must match exactly, including the path and absence of a trailing slash. A self-hosted installation must substitute its own HTTPS origin. Register only the redirect addresses that installation needs.

These scopes permit catalog lookup, reading the user’s library, and identifying the connected account through public profile fields. No write, email, account-management, journal, or social scope is requested. After creating the application, copy its **Client ID**. A single-page application uses a public client ID and PKCE; no client secret is needed.

### 2. Configure the Worker runtime

Set the runtime variable:

```text
HARDCOVER_CLIENT_ID=<the public client ID from Hardcover>
```

For repeatable GitHub deployments, add it alongside `APP_ORIGIN` in the existing `vars` section of `wrangler.jsonc`, then deploy that change:

```json
"vars": {
  "APP_ORIGIN": "https://cybershelf.io",
  "HARDCOVER_CLIENT_ID": "your-public-client-id"
}
```

The client ID is public configuration and may be committed to the open-source repository. Do not put a personal access token or client secret in this field.

You can also set `HARDCOVER_CLIENT_ID` under the **cybershelf Worker’s runtime variables** in Cloudflare and deploy that configuration. This is different from a Workers Builds environment variable: the application reads the value from the running Worker through `/api/connections/config`. A build-only variable is insufficient. Keep the tracked Wrangler configuration aligned so subsequent repository deployments retain the setting.

No additional database, bucket, scheduled job, or provider-token storage is required for this connector.

### 3. Check the connection

After deployment, sign in to Cybershelf and open Connections. Hardcover should offer its connect action. Approve the connection, review the preview, and import. Confirm that a book links back to Hardcover and that a manual sync completes. If Hardcover rejects the return address, compare the registered redirect URI with the exact production URL above.

If the connection is still unavailable, check the **runtime** variable name and value, then reload the page. Do not replace the public client ID with a token or password.

## Credential handling and privacy

The browser performs the OAuth authorization-code flow with **S256 PKCE**. A random state value and verifier are held temporarily in session storage, bound to the Cybershelf account, client ID, and callback address, and expire after ten minutes. The callback validates those values and the provider issuer before exchanging its one-use code. It removes the callback query from the address bar and consumes the pending state before making provider requests.

Token exchange, library requests, refresh, and revocation go directly from the browser to Hardcover. Provider access and refresh tokens stay in memory; they are not sent to Cybershelf’s API, written to its database, or included in backups. Sign-out, an account change, or disposal of the browser session clears them. Refresh rotation is serialized, and an ambiguous failed refresh is not retried with the same credential.

The saved connection contains a user-chosen label, preferences, sync history, and an account-scoped matching fingerprint. Imported books also retain their source identifiers and the last accepted metadata used to preserve local edits. The matching fingerprint is pseudonymisation, not encryption.

**Imported library data remains part of the ordinary Cybershelf account database.** Service operators can access that data; browser-only provider credentials do not make the library end-to-end encrypted. Operators also control the JavaScript delivered by the website and could change it in a later deployment. This release therefore makes a specific, auditable promise about its current credential handling, not a claim that the service operator is cryptographically unable to access every user detail.

## Provider capabilities and next steps

Only Hardcover account sync and the existing Goodreads CSV importer are implemented here. The next integrations should use supported authorization or export paths with clear permissions and predictable behavior.

| Provider | Verified capability | Cybershelf direction |
| --- | --- | --- |
| **Hardcover** | Public-client OAuth with PKCE, scoped read access, browser CORS, library and edition data. | Implemented: browser-session import and refresh, optional reading progress, no writes back. |
| **Google Books / Play Books** | Authenticated bookshelf APIs include Purchased and My eBooks. Google supports a browser token model, but the Books scope is `https://www.googleapis.com/auth/books`, described as “Manage your books.” | Next native connector to evaluate. Its provider permission is broader than read-only app behavior, which must be explained before consent. |
| **Goodreads** | No new developer API keys; library CSV export is available. | Existing CSV importer. Keep it clearly labelled as an import, rather than a live account connection. |
| **StoryGraph** | CSV export is shipped; a general API remains on its official long-term roadmap. | Prioritize an export importer. A direct connection depends on a supported provider integration becoming available. |
| **Kobo** | Official partner integrations include reading progress to StoryGraph and annotations to Readwise. | Investigate a partner integration. A general self-service account API for Cybershelf has not been verified. |
| **Amazon / Kindle** | Amazon Data Portability includes digital-order and Kindle-usage scopes, with identity/security assessment and application allowlisting. | Evaluate approved access and actual book/progress coverage before offering a connector. Ordinary Amazon sign-in is not sufficient. |
| **Apple Books** | Apple offers consumer data/privacy exports. The Apps and Books for Organizations API serves enterprise device management. | Evaluate suitable exports or a supported consumer integration; no consumer Books account OAuth connector has been verified. |
| **BookWyrm** | Official CSV export includes shelved books, reviewed books, and books with reading activity. | An export importer is a practical future addition. Federation alone does not establish a general account OAuth connector. |

The sequence is: finish real-world Hardcover verification, evaluate Google’s permission tradeoff, improve export imports, then pursue provider partnerships or approved portability APIs. Bidirectional updates and synchronization while the app is closed require separate product and security decisions; they are not features of this release.

### Primary references

- Hardcover: [OAuth lifecycle](https://github.com/hardcoverapp/hardcover-docs/blob/67eafe950a8e4ea1b67de033c2a29ea1edbb9538/src/content/docs/api/OAuth.mdx), [single-page app guide](https://github.com/hardcoverapp/hardcover-docs/blob/67eafe950a8e4ea1b67de033c2a29ea1edbb9538/src/content/docs/api/OAuth/Getting-Started-SPA.mdx), [scopes](https://github.com/hardcoverapp/hardcover-docs/blob/67eafe950a8e4ea1b67de033c2a29ea1edbb9538/capabilities.json), and [library fields](https://github.com/hardcoverapp/hardcover-docs/blob/67eafe950a8e4ea1b67de033c2a29ea1edbb9538/src/content/docs/api/GraphQL/Schemas/UserBooks.mdx). The referenced official documentation commit is dated 21 October 2026. Live discovery, scope metadata, and CORS endpoints were also checked on 22 October 2026 without accessing a user account.
- Google: [Books concepts and predefined shelves](https://developers.google.com/books/docs/v1/getting_started), [OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes#books), and [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).
- Goodreads: [API status](https://help.goodreads.com/s/article/Does-Goodreads-support-the-use-of-APIs) and [import/export page](https://www.goodreads.com/review/import).
- StoryGraph: [API roadmap](https://roadmap.thestorygraph.com/features/posts/an-api) and [export confirmation](https://roadmap.thestorygraph.com/requests-ideas/posts/export-csv).
- Kobo: [StoryGraph progress integration](https://help.kobo.com/hc/en-us/articles/40276991427223-Sync-Your-Kobo-Reading-Progress-with-StoryGraph) and [Readwise annotations integration](https://help.kobo.com/hc/en-us/articles/10789206247703-Use-Readwise-to-view-and-manage-your-annotations).
- Amazon: [data portability scopes](https://developer.amazon.com/docs/amazon-data-portability/available-scopes.html), [onboarding](https://developer.amazon.com/docs/amazon-data-portability/intro-configure.html), and [application allowlisting](https://developer.amazon.com/docs/amazon-data-portability/portability-allowlist.html).
- Apple: [consumer data and privacy tools](https://support.apple.com/en-us/102283) and [Apps and Books for Organizations API](https://developer.apple.com/help/account/service-configurations/apps-and-books-for-organizations/).
- BookWyrm: [settings and CSV export](https://docs.joinbookwyrm.com/settings.html).
