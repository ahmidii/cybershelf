# Community safety and moderation

## Reader controls

Readers can report public profiles, shelves, reading updates, replies, explicit book announcements, manually created community book pages, and shared artwork. The server resolves the target from the public record. A request cannot choose the accused account or substitute its own evidence. The queue contains a bounded excerpt of the public item and up to 2,000 characters supplied by the reporter, not private library records or original files.

Reports require a signed-in account and use durable per-account limits: five attempts per minute and 25 per day. One reader has one report per target. Repeating an open report does not create another queue entry or overwrite the original explanation. A resolved report may be reopened after a day. These controls limit spam; they do not automatically decide whether content should be removed.

Use **Report or block** on the item itself. Blocking removes following relationships in both directions, prevents following and replies across that relationship, and removes the reader's content from reciprocal signed-in views, including the Following feed and Reading together. Replies by a blocked account are also filtered from other readers' conversations. Database triggers prevent an in-flight follow or reply from bypassing a newly created block. A reply without a published profile can still identify its author for blocking without exposing that author's account ID.

Blocking is not a confidentiality control. Public content remains accessible when signed out, and previously captured copies cannot be recalled. Unblocking at `/safety` does not silently restore following relationships. Blocks do not generate notifications.

## Set up a moderator

There is no default administrator and no automatic first-user promotion.

1. Sign in to the Cybershelf account that will moderate.
2. Open **Account & security → Safety & blocked readers**, or `/safety`.
3. Expand **Account identifier** and copy that account's ID. It is an identifier, not an authentication credential.
4. In the existing Cloudflare Worker's **runtime variables**, set `MODERATOR_USER_IDS` to that exact ID. Multiple IDs use commas, with a maximum of 20. Use Cybershelf account IDs, not usernames, email addresses, or GitHub IDs.
5. Open `/moderation` from that account. If the setting is missing or invalid, moderator access fails closed. Confirm that an ordinary second account cannot open the queue.

A moderator still signs in through the normal account flow. Protect the moderator's password and recovery key. Removing an ID from the runtime allowlist removes its moderator authority after the updated Worker configuration is serving requests.

## Review a report

The queue offers Open, Actioned, and Dismissed views with bounded cursor pagination. It shows the public excerpt captured when the report was submitted, the selected reason, the reporter's explanation, and timestamps. It does not show the reporter's account ID to the reported reader or expose reporters through public APIs.

**Review current content & audit** reads only the reported target's published-table text, including material currently hidden from the public, and its decision history. It cannot open an arbitrary private library or file. Compare the original excerpt and current text before restoring an item that may have changed.

Every moderation action requires a recorded note, explicit confirmation in the interface, the expected signed-in account, same-origin POST, and a moderator sign-in less than 15 minutes old. An older session is asked to sign in again.

Available actions:

| Action | Result |
| --- | --- |
| Dismiss | Closes the report without changing the public item. |
| Hide | Withholds that public item, associated public image routes, and dependent feed/conversation appearances. The owner's private library is not erased. |
| Restore item | Removes that item's hiding marker. Existing source records must still exist. |
| Pause account participation | Hides the account's public content and contributions and stops public publishing, follows, replies, and uploads. Private library access, export, account security, and deletion remain available. |
| Restore account participation | Removes the account's suspension. Separately hidden items remain hidden. |

The actor's immutable moderator ID, action, note, target account, report reference, and timestamp form the audit record. Moderators cannot suspend themselves or another currently configured moderator through this queue. Administrator access disputes are handled by changing the runtime allowlist.

Hiding one publication is a scoped action. If someone repeatedly deletes and republishes abusive material under new public identifiers, use account suspension. Suspensions are not automatically lifted. Moderators must review restoration deliberately.

## Privacy and operating responsibilities

### Review shared artwork

The `/moderation` page also lists pending decorations, spines, and covers. Review the submitted image, creator credit, source, permission, and edition/printing before approving. Book artwork can be correctly linked to a catalogue edition yet still show the wrong physical printing; metadata verification does not replace image review. Self-approval is refused. Approval, rejection, and withdrawal require a recent moderator sign-in and an audit note.

Pending contributions are available only to their contributor and authorized moderators. Approval makes the separate image copy reusable; rejection and withdrawal revoke its serving route and queue byte cleanup. A report can hide an approved contribution while preserving a reviewable record. Restoring a hiding flag cannot undo an independent withdrawal. Curated items can also be withheld without changing their source license.

Contribution decision notes are visible to the contributor and configured moderators; ordinary report explanations remain private to moderators. Do not put reporter identities or unrelated private information into a contributor-visible note. Account deletion removes reviewer-authored audit text and the corresponding current review note where applicable. Approved contributions may survive contributor deletion with the account relationship detached, but existing hiding/suspension restrictions remain effective. See [shared artwork](shared-assets.md).

Report details and report-moderation notes are visible only to configured moderators. They may contain personal information volunteered by a reporter, so do not copy them to public issues or third-party chats. The service operator can access stored records; this is not end-to-end encrypted reporting.

Account deletion erases associated reports, captured excerpts, and related audit text, in addition to removing blocks, hiding markers, and suspension records. Reports and decisions are otherwise retained until explicitly removed; this release does not promise an automatic retention deadline. Backups follow the operator's separately documented retention and restoration procedure.

The product provides a review queue, not a staffed moderation service. Before inviting a broad public audience, configure at least one actual moderator, assign responsibility for reviewing open reports, publish a suitable private support contact, and verify that operational alerts reach the responsible operator. No email or notification is sent automatically to reported readers or reporters by this workflow.
