# Beta readiness assessment

Assessed 2026-11-09 against deployed source `3f8614061dc21a58cf57a4b39d957814cf65d68d` (0.7.0) and the local 0.8.0-beta.1 candidate. This is a source review and automated integration assessment, not an independent penetration test or a security guarantee.

## Decision

A small, personally invited and closely supported beta is the appropriate next stage after the authentication dependency update is installed and the resulting build passes verification. General public promotion should wait for the account lifecycle, abuse, and operational gaps below. Registration is currently open: inviting a small group is a rollout choice, not a technical invitation gate.

The 0.8 candidate is not live. Its username and recovery-key implementation is prepared separately from the deployed 0.7 account flow. See [release status](release-status.md) for accepted test results and the release hold.

## What is already protected

- Passwords are stored as salted password hashes, never recoverable plaintext. Existing 0.7 hashes remain valid in the candidate. New or reset passwords use versioned scrypt with `N=32768`, `r=8`, `p=3`, a random 16-byte salt, and constant-time comparison. This is one of OWASP's listed scrypt configurations. Existing hashes upgrade when their password is changed or reset, not automatically at login.
- Session cookies use HTTPS Secure, HttpOnly, and SameSite settings. Sessions are backed by D1; unsigned cookies and caller-supplied identity headers do not authenticate a request.
- Authentication uses an explicit trusted origin, durable rate limits, current-password checks for sensitive changes, and session revocation after recovery. A stale browser tab cannot silently mutate a different signed-in account.
- Private API and file access are owner-scoped. Published shelves and reading updates are explicit public representations, not direct exposure of a private library. Original EPUB/PDF files are not served by public image routes.
- Recovery keys contain 256 random bits. Only their digest is stored, and successful recovery replaces the key and revokes existing sessions. Keys are not sent through email, placed in URLs, or saved into browser storage by the app.
- The candidate adds anti-framing headers on HTML, a no-referrer policy, and nosniff. This is not a complete script-restricting Content Security Policy.

References: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), and the production implementations in `lib/server/auth.ts`, `lib/server/passwords.ts`, `lib/server/username-accounts.ts`, and `worker/index.ts`.

## Authentication dependency hold

The installed Better Auth and Drizzle adapter are pinned to 1.7.8. Better Auth's [2026-11-03 security release](https://better-auth.com/blog/security-release-2026-11-03) identifies stable 1.7.16 as the patched release and directs users to update its packages together.

Several published attack conditions concern plugins or configurations that Cybershelf does not enable, including mobile/desktop integrations, phone or email OTP, organization/admin/Stripe plugins, OAuth sign-in, MySQL serial identifiers, and secondary session storage. A version difference alone is not proof that this deployment is exploitable. It is nevertheless prudent to update before inviting new users.

The update failed with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` because `pnpm-workspace.yaml` requires releases to age seven days. No exception was applied. The latest currently blocked transitive release reaches seven days around 2026-11-10 21:25 UTC. The safe options are to wait for those versions to mature, or obtain approval for exact-version exceptions covering only the reviewed security patch and its required packages, then install and rerun verification. A source candidate tested against 1.7.8 does not count as verification of 1.7.16.

## What “no email required” means

New readers choose a username and password. They do not have to provide a real name, email address, or retailer login. The authentication schema retains a random, non-deliverable internal address, which is not an actual contact address and is not presented as one in the interface. Existing email accounts retain their email until a separate, deliberate account-data change is implemented.

This provides pseudonymity. Cybershelf and its hosting infrastructure still process account identifiers, sessions, network information, libraries, and shared activity. Stored library data is protected by authorization, not end-to-end encryption. A reused username, uploaded photo, or public reading post may identify its author. External cover and decoration hosts receive requests from the reader's browser.

For a username account, losing both the password and recovery key means there is no supported account-recovery path. Do not promise recovery through screenshots, public profile details, or a support conversation: those do not prove ownership. Save the key privately. After using or replacing it, save the new key because the old one no longer works.

## Gaps before a broad public beta

| Area | Current limit | Needed next step |
| --- | --- | --- |
| Account deletion | No complete self-service deletion flow. Removing an auth row alone would leave related data or uploads behind. | Fresh-auth deletion with coordinated D1 cleanup, revocation of public content, and retryable R2 removal. |
| Abuse response | No reader blocking/reporting or operator moderation workflow. Reply authors and conversation owners have limited removal controls. | Add reporting, blocking, accountable moderation actions, and a private support/reporting contact. |
| Upload cost controls | Per-account size/count limits exist, but the quota check and upload are separate operations. Concurrent uploads can race the check. | Reserve quota atomically and add durable upload limits before large-scale open registration. |
| Image privacy | Ordinary uploaded images may retain source metadata. External image hosts receive the visitor's network address. Cropped spine exports are re-encoded. | Strip sensitive image metadata consistently and evaluate an image proxy with clear limits. |
| Recovery and retention | Recovery keys and email recovery work in their supported paths, but a complete retention/deletion policy and operator procedure are not established. | Define what is retained, how support verifies ownership, and how deletion is completed. |
| Production operations | Source cannot prove administrator MFA, current Cloudflare backup/restore settings, bucket exposure, alerting, or spending controls. | Verify settings and perform a restore drill for both D1 metadata and R2 originals before relying on backups. |
| Password defenses | No passkeys/MFA or full compromised-password screening. Local predictability checks have limited coverage. | Consider passkeys and comprehensive screening after the basic beta is stable. |
| Device testing | Automated tests exercise application behavior but do not replace physical iPhone/iPad testing. | Test signup/recovery, keyboard interaction, gestures, and spine-photo cropping on real devices. |

These are observed implementation or verification limits. A Cloudflare setting that is not visible in source may already be configured; it must be checked before making a claim either way.

## Operational handoff

Keep the existing authentication secret and resource identifiers. Do not recreate D1/R2 or rotate a working secret solely because a dependency version changed. Apply only the additive migration through the existing deploy script after the candidate is approved for release. Review authentication latency and Worker CPU-limit metrics under expected beta load: local native-scrypt timings are not a measurement of the production plan's billed CPU budget.

Start with a small known group, explain recovery-key responsibility and explicit sharing, collect reproducible bugs without requesting passwords or recovery keys, and expand only after the remaining lifecycle and operational controls are in place.
