import type { Metadata } from 'next';
import AccountFrame from '@/components/AccountFrame';
import styles from '@/components/Account.module.css';

export const metadata: Metadata = {
  title: 'Privacy and your data — cybershelf',
  description: 'What Cybershelf keeps private, what you choose to share, and how accounts, reports, deletion, and recovery copies work.',
};

export default function PrivacyPage() {
  return <AccountFrame wide>
    <article className={styles.document}>
      <header className={styles.intro}><p className={styles.eyebrow}>YOUR READING LIFE, YOUR CHOICES</p><h1>Privacy and your data.</h1><p>A plain-language guide to what this beta stores and shares. Updated 9 November 2026.</p></header>
      <section>
        <h2>A name you choose.</h2>
        <p>New accounts use a username and password. You do not need to provide an email address or your real name. Your username initially becomes your display name; you can change the display name in your reading space.</p>
        <p>This is a <strong>pseudonymous account</strong>. It does not make your activity untraceable or completely anonymous. Public writing, images, reading habits, and names you choose can identify you. The service and its hosting infrastructure still process account and network information.</p>
      </section>
      <section>
        <h2>What stays private.</h2>
        <p>Your account library, private reading journal, reviews, notes, source links, physical book locations, and uploaded book files are available to your signed-in account. Other readers cannot access them through your public profile or shelf.</p>
        <p>Private data is protected by account access controls. It is not end-to-end encrypted: the service operator can access stored library metadata and files. Avoid using private notes for information you would not entrust to the service.</p>
      </section>
      <section>
        <h2>What you choose to share.</h2>
        <p>Publishing a shelf shares a separate snapshot of its display name, description, displayed books, artwork, and decorations. A published profile includes its name, bio, and featured shelf. Sharing a reading update publishes that entry, its book, progress marker, and date. Replies are public within their conversation.</p>
        <p>Community ratings and completed reads that you explicitly contribute appear in a book’s public totals. A shared reading update that marks a book finished can also contribute to those totals. These contributions are separate from your private library ratings and logs. Creating a community book page publishes only its title and author.</p>
        <p>Private changes do not automatically update a published shelf. You can unpublish shelves and profiles and remove shared updates, your replies, and your own community ratings and read records. Existing copies someone has saved or captured cannot be recalled. Spoiler controls follow the markers readers choose; public writing is not confidential.</p>
      </section>
      <section>
        <h2>Reports and blocked readers.</h2>
        <p>Use <strong>Report or block</strong> beside public content to report a concern or block its author. A report stores a limited excerpt of the public item, your selected reason, and any explanation you provide. Configured moderators can review that information and record a decision. The reported reader is not given your account identity or explanation. Do not include passwords, recovery keys, or unrelated private information in a report.</p>
        <p>Blocking removes follows in both directions, prevents following and replies between those accounts, and filters their content from each other’s signed-in views, including the feed and Reading together. It does not make public content private: it can still be viewed while signed out. Unblocking at <a href="/safety">Safety &amp; blocked readers</a> does not restore a follow. No block notification or automatic report-decision email is sent.</p>
        <p>Moderators can hide public content or pause public participation. The review queue can inspect the reported public item and its decision history; it does not open unrelated private libraries or original files. A suspended reader can still access their private library, export it, manage account security, and delete their account. Reports are protected by access controls and are not end-to-end encrypted.</p>
      </section>
      <section>
        <h2>Account security and recovery.</h2>
        <p>Passwords are stored as salted hashes. Session records and security controls may retain network information, including IP addresses and browser information. A secure session cookie keeps you signed in.</p>
        <p>A recovery key lets you reset a forgotten password. The usable key is shown when it is created or replaced; the server keeps a one-way representation. Anyone with the key can reset your password, so keep it private. A successful recovery invalidates the old key, issues a new one, and signs out the account’s existing sessions.</p>
        <p>For an account without email, losing both the password and recovery key means access cannot be restored. Existing email accounts retain their email sign-in and configured email recovery. Adding or removing an email address is not available in this release.</p>
      </section>
      <section>
        <h2>Files, artwork, and other services.</h2>
        <p>The hosted service uses Cloudflare Workers, D1, and R2 to run the app and store account data and files. Resend handles account emails for accounts that have an email address when email delivery is enabled.</p>
        <p>Book catalogs and externally hosted cover, spine, or decoration images involve requests to other services. An external image host can receive your network information when an image loads. A URL you add is not copied into Cybershelf automatically.</p>
        <p>The spine-photo editor uploads only your cropped spine, without the source photograph’s metadata. Other image uploads can retain embedded metadata, such as camera or location information. Remove personal metadata before sharing those images. Original EPUB/PDF files remain private and are downloaded as files rather than published with your shelf.</p>
        <p>Where enabled, the Hardcover connector keeps provider credentials in the current browser session; imported book metadata is stored with your Cybershelf library. Goodreads support uses a CSV file you choose to import.</p>
      </section>
      <section>
        <h2>Take a copy with you.</h2>
        <p>In your reading space, Settings provides JSON and CSV exports and a ZIP of referenced uploaded files within the displayed size limits. These are library backups; they do not include every social record or restore follows, public conversations, or public contributions.</p>
        <p>Your browser can also hold a guest draft. A guest draft stays in that browser and is not an account backup. Save exports somewhere private because they can contain your notes, sources, and original files. Copies you download are under your control and are not removed when you delete your account.</p>
      </section>
      <section>
        <h2>Remove a file or your account.</h2>
        <p>Removing a book or source from your library does not automatically delete its uploaded original. You can remove an unused uploaded file separately after removing the references that still use it.</p>
        <p>To leave Cybershelf, open <a href="/account">Account &amp; security</a> and choose account deletion. You must sign in recently, enter your current password, and explicitly confirm. Once accepted, deletion removes your sign-in, sessions, recovery credentials, private library, public profile and shelves, reading content, follows, and community contributions together. Replies attached to conversations you started also disappear.</p>
        <p>Associated reports, captured excerpts, and linked moderation notes are erased with the account. Shared title-and-author catalog records can remain because they are bibliographic records without an account owner. Reports and decisions otherwise have no automatic application retention deadline in this release.</p>
        <p>Uploaded files immediately lose access through your account and public sharing routes. If storage is temporarily unavailable, their removal is queued and retried; you do not need to keep the deletion page open. For an upload that never finished, an empty storage marker may remain to prevent a delayed write from recreating the deleted file. It contains no original file bytes or filename and has no live account link. Deletion cannot recall copies other people saved.</p>
      </section>
      <section>
        <h2>Recovery copies after deletion.</h2>
        <p>The operator recovery policy limits private database/file recovery copies and incident exports to <strong>30 days</strong>. These copies are restricted to recovery work and are not an account-recovery service for readers. Storage services can take additional time to finish expiring a copy after its scheduled date; this policy does not promise physical removal at an exact second.</p>
        <p>A minimal private deletion record keeps only an opaque former account identifier and deletion/expiry dates for <strong>35 days</strong>. It allows a restored service to honor deletions made after an older backup. The operator must keep that record long enough to cover the actual surviving backup history, including delayed expiry.</p>
        <p>Before a restored service opens, it must apply current account deletions and security state, revoke old sessions and reset links, and honor current moderation and sharing restrictions. Restoring an old copy must not re-enable a consumed recovery key, an old password, or a deleted account. Periodic file copies can lag new uploads, so they do not guarantee recovery of every recent file.</p>
        <p>The <a href="https://github.com/ahmidii/cybershelf/blob/main/docs/production-operations.md" target="_blank" rel="noreferrer">operations runbook</a> and <a href="https://github.com/ahmidii/cybershelf/blob/main/docs/original-backups.md" target="_blank" rel="noreferrer">original-file backup guide</a> explain this policy and the required checks. The <a href="https://github.com/ahmidii/cybershelf/blob/main/docs/beta-readiness.md" target="_blank" rel="noreferrer">beta readiness record</a> distinguishes prepared safeguards from verified production settings.</p>
      </section>
      <section>
        <h2>About this beta.</h2>
        <p>Cybershelf is open source. The <a href="https://github.com/ahmidii/cybershelf" target="_blank" rel="noreferrer">project repository</a> explains the current implementation and release limits. The <a href="https://github.com/ahmidii/cybershelf/blob/main/docs/moderation.md" target="_blank" rel="noreferrer">moderation guide</a> describes report handling, and the <a href="https://github.com/ahmidii/cybershelf/blob/main/docs/upload-storage.md" target="_blank" rel="noreferrer">upload guide</a> explains file limits and cleanup. Never post passwords, recovery keys, private files, or other account details in public issues.</p>
        <p><a href="/signin">Sign in or create an account</a> · <a href="/forgot-password">Account recovery</a> · <a href="/safety">Safety &amp; blocked readers</a></p>
      </section>
    </article>
  </AccountFrame>;
}
