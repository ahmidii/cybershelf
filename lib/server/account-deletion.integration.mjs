import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const legacyHash = '0123456789abcdef0123456789abcdef:57affd10380409758f367869d68e1ecc4cb021c67e86a84036865b67472cc4670c8f3e29134ea6f9cdac4cf3984ffde0790496df8ddfb62ed3969038fab719ba';

// The normal flow uses the built Worker. The failure-injection flow compiles
// these same production functions, with the same real D1/session and R2 test
// bindings, so only the bucket operation that fails is substituted.
async function deletionFunctions() {
  const dir = mkdtempSync(resolve('.sites-runtime/account-deletion-test-'));
  for (const source of ['lib/auth-contract.ts', 'lib/account-identity.ts', 'db/schema.ts', 'lib/server/auth-email.ts', 'lib/server/passwords.ts', 'lib/server/auth.ts', 'lib/server/asset-transfers.ts', 'lib/server/account-deletion.ts']) {
    const output = resolve(dir, source.replace(/\.ts$/, '.mjs'));
    mkdirSync(dirname(output), { recursive: true });
    const code = ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, specifier) => `from ${quote}${specifier}.mjs${quote}`);
    writeFileSync(output, code);
  }
  return { ...await import(pathToFileURL(resolve(dir, 'lib/server/account-deletion.mjs'))), dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function runAccountDeletionIntegration({ base, fetch: requestFetch, database, bucket, authBindings, report }) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 9);
  const password = 'Maple leaves beside a quiet window';
  const stamp = new Date().toISOString();
  let ip = 1;
  const raw = (path, init = {}) => requestFetch(new URL(path, base).href, init);
  const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const body = { currentPassword: password, confirmation: 'DELETE' };
  const options = (account, details = body, extra = {}) => ({ method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: base, 'cf-connecting-ip': `198.20.0.${ip++}`,
    ...(account ? { Cookie: account.cookie, 'X-Cybershelf-Account': account.id } : {}), ...extra,
  }, body: JSON.stringify(details) });
  const expect = async (response, status, label) => {
    assert.equal(response.status, status, `${label}: ${response.status === status ? '' : await response.clone().text()}`);
    return response;
  };
  const signup = async name => {
    const username = 'erase_' + name + '_' + suffix;
    const response = await expect(await raw('/api/auth/sign-up/username', options(null, { username, password })), 200, 'Deletion fixture signup');
    const created = await response.json();
    return { id: created.user.id, username, key: created.recoveryKey, cookie: cookieFrom(response) };
  };
  const owner = await signup('owner'), other = await signup('other');
  const asset = async (account, name, image = false) => {
    const id = 'as_' + crypto.randomUUID(), key = 'private/' + id;
    const content = image ? Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) : new TextEncoder().encode('%PDF-1.7\nprivate-' + name);
    await bucket.put(key, content);
    await database.prepare('INSERT INTO assets (id,owner_id,kind,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, account.id, image ? 'image' : 'book', key, name, image ? 'image/png' : 'application/pdf', content.length, stamp).run();
    return { id, key, content };
  };
  const book = await asset(owner, 'Private original.pdf'), image = await asset(owner, 'Private artwork.png', true), untouched = await asset(other, 'Other original.pdf');
  const pub = 'pub_' + suffix, profile = 'profile_' + suffix, post = 'post_' + suffix;
  const otherProfile = 'profile_other_' + suffix, otherPost = 'post_other_' + suffix;
  const reportByOwner = 'report_by_' + suffix, reportOnOwner = 'report_on_' + suffix, unrelatedReport = 'report_other_' + suffix;
  const snapshot = JSON.stringify({ id: profile, name: 'Deletion reader', bio: 'Private-to-erased-account biography', shelf: { id: 'shelf1', title: 'Erased shelf', items: [] } });
  const postSnapshot = JSON.stringify({ id: post, body: 'Erased public thought', progress: 20, createdAt: stamp, book: { title: 'A book', author: 'A writer', color: '#bbaabb' } });
  const imageIds = JSON.stringify([image.id]);
  await database.batch([
    database.prepare('INSERT INTO libraries (owner_id,state,version,updated_at) VALUES (?,?,1,?)').bind(owner.id, JSON.stringify({ private: 'erased private library' }), stamp),
    database.prepare('INSERT INTO libraries (owner_id,state,version,updated_at) VALUES (?,?,1,?)').bind(other.id, JSON.stringify({ private: 'keep this other library' }), stamp),
    database.prepare('INSERT INTO publications (id,owner_id,shelf_id,snapshot,image_ids,published_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(pub, owner.id, 'shelf1', snapshot, imageIds, stamp, stamp),
    database.prepare('INSERT INTO public_profiles (id,owner_id,shelf_id,snapshot,image_ids,published_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(profile, owner.id, 'shelf1', snapshot, imageIds, stamp, stamp),
    database.prepare('INSERT INTO public_profiles (id,owner_id,shelf_id,snapshot,image_ids,published_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(otherProfile, other.id, 'shelf1', JSON.stringify({ id: otherProfile, name: 'Other reader' }), '[]', stamp, stamp),
    database.prepare('INSERT INTO reading_posts (id,owner_id,profile_id,book_id,entry_id,snapshot,image_ids,published_at,updated_at,book_key) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(post, owner.id, profile, 'book1', 'entry1', postSnapshot, imageIds, stamp, stamp, 'fixture-book'),
    database.prepare('INSERT INTO reading_posts (id,owner_id,profile_id,book_id,entry_id,snapshot,image_ids,published_at,updated_at,book_key) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(otherPost, other.id, otherProfile, 'book1', 'entry1', postSnapshot, '[]', stamp, stamp, 'fixture-book'),
    database.prepare('INSERT INTO reading_comments (id,post_id,owner_id,profile_id,name,body,progress,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('comment_own_' + suffix, otherPost, owner.id, profile, 'Erased name', 'Erased reply on another reader', 20, stamp),
    database.prepare('INSERT INTO reading_comments (id,post_id,owner_id,profile_id,name,body,progress,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('comment_child_' + suffix, post, other.id, otherProfile, 'Other name', 'Child conversation must go with its parent', 20, stamp),
    database.prepare('INSERT INTO reading_events (id,owner_id,kind,created_at) VALUES (?,?,?,?)').bind('event_' + suffix, owner.id, 'comment', stamp),
    database.prepare('INSERT INTO follows (follower_id,followed_owner_id,followed_profile_id,created_at) VALUES (?,?,?,?)').bind(owner.id, other.id, otherProfile, stamp),
    database.prepare('INSERT INTO follows (follower_id,followed_owner_id,followed_profile_id,created_at) VALUES (?,?,?,?)').bind(other.id, owner.id, profile, stamp),
    database.prepare('INSERT INTO reader_activity (id,owner_id,profile_id,kind,book_id,snapshot,created_at) VALUES (?,?,?,?,?,?,?)').bind('activity_' + suffix, owner.id, profile, 'added', 'book1', '{}', stamp),
    database.prepare('INSERT INTO book_ratings (owner_id,catalog_id,rating,created_at,updated_at) VALUES (?,?,?,?,?)').bind(owner.id, 'OL45804W', 4, stamp, stamp),
    database.prepare('INSERT INTO book_reads (owner_id,id,catalog_id,finished_at,created_at) VALUES (?,?,?,?,?)').bind(owner.id, 'read_' + suffix, 'OL45804W', '2026-11-01', stamp),
    database.prepare('INSERT INTO reader_blocks (id,blocker_id,blocked_owner_id,blocked_profile_id,created_at) VALUES (?,?,?,?,?)').bind('block_' + suffix, owner.id, other.id, otherProfile, stamp),
    database.prepare('INSERT INTO moderation_reports (id,reporter_id,target_kind,target_id,target_owner_id,reason,details,public_snapshot,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(reportByOwner, owner.id, 'profile', otherProfile, other.id, 'harassment', 'Erased reporter private detail', '{}', 'open', stamp, stamp),
    database.prepare('INSERT INTO moderation_reports (id,reporter_id,target_kind,target_id,target_owner_id,reason,details,public_snapshot,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(reportOnOwner, other.id, 'profile', profile, owner.id, 'harassment', 'Report about erased person', snapshot, 'open', stamp, stamp),
    database.prepare('INSERT INTO moderation_reports (id,reporter_id,target_kind,target_id,target_owner_id,reason,details,public_snapshot,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(unrelatedReport, other.id, 'profile', otherProfile, other.id, 'spam', 'Unrelated report remains', '{}', 'open', stamp, stamp),
    database.prepare('INSERT INTO moderation_actions (id,report_id,moderator_id,target_owner_id,action,note,created_at) VALUES (?,?,?,?,?,?,?)').bind('action_report_' + suffix, reportByOwner, other.id, other.id, 'dismiss', 'Quoted reporter detail must be erased', stamp),
    database.prepare('INSERT INTO moderation_actions (id,report_id,moderator_id,target_owner_id,action,note,created_at) VALUES (?,?,?,?,?,?,?)').bind('action_owned_' + suffix, unrelatedReport, owner.id, other.id, 'dismiss', 'Erased moderator note', stamp),
    database.prepare('INSERT INTO auth_verification (id,identifier,value,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('verification_' + suffix, 'reset-password:deletion-fixture-' + suffix, owner.id, Date.now() + 60000, Date.now(), Date.now()),
  ]);
  await expect(await raw('/api/publications/' + pub), 200, 'Fixture shelf starts public');
  await expect(await raw('/api/profiles/' + profile + '/assets/' + image.id), 200, 'Fixture public artwork starts accessible');
  await expect(await raw('/api/account/delete', options(null)), 401, 'Deletion requires a session');
  await expect(await raw('/api/account/delete', options(owner, body, { 'X-Cybershelf-Account': other.id })), 409, 'Stale account deletion is rejected');
  await expect(await raw('/api/account/delete', options(owner, body, { Origin: 'https://attacker.invalid' })), 403, 'Cross-origin deletion is rejected');
  await expect(await raw('/api/account/delete', options(owner, { ...body, confirmation: 'delete' })), 400, 'Deletion needs exact irreversible confirmation');
  await expect(await raw('/api/account/delete', options(owner, { ...body, currentPassword: 'A different long password' })), 400, 'Deletion needs the current password');
  const ownerSession = await database.prepare('SELECT id,created_at FROM auth_session WHERE user_id = ? LIMIT 1').bind(owner.id).first();
  await database.prepare('UPDATE auth_session SET created_at = ? WHERE id = ?').bind(Date.now() - 16 * 60000, ownerSession.id).run();
  await expect(await raw('/api/account/delete', options(owner)), 403, 'Older sessions must reauthenticate for deletion');
  await database.prepare('UPDATE auth_session SET created_at = ? WHERE id = ?').bind(ownerSession.created_at, ownerSession.id).run();
  assert.ok(await database.prepare('SELECT id FROM auth_user WHERE id = ?').bind(owner.id).first());
  assert.ok(await bucket.head(book.key), 'Refused deletion has no storage side effects');

  const deleted = await expect(await raw('/api/account/delete', options(owner)), 200, 'Complete account deletion');
  assert.deepEqual(await deleted.json(), { deleted: true, filesPending: false });
  assert.ok(deleted.headers.getSetCookie().every(value => /Max-Age=0/.test(value)), 'Deletion clears session cookies');
  for (const [table, column] of [['libraries', 'owner_id'], ['assets', 'owner_id'], ['publications', 'owner_id'], ['public_profiles', 'owner_id'], ['reading_posts', 'owner_id'], ['reading_comments', 'owner_id'], ['reading_events', 'owner_id'], ['reader_activity', 'owner_id'], ['book_ratings', 'owner_id'], ['book_reads', 'owner_id'], ['auth_account', 'user_id'], ['auth_session', 'user_id'], ['account_recovery_keys', 'user_id'], ['auth_user', 'id'], ['account_deletion_jobs', 'owner_id'], ['asset_transfers', 'owner_id']]) {
    assert.equal((await database.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${column} = ?`).bind(owner.id).first()).total, 0, table + ' is erased');
  }
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM reading_comments WHERE post_id = ?').bind(post).first()).total, 0, 'Replies on erased conversations are erased');
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM follows WHERE follower_id = ? OR followed_owner_id = ?').bind(owner.id, owner.id).first()).total, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM reader_blocks WHERE blocker_id = ? OR blocked_owner_id = ?').bind(owner.id, owner.id).first()).total, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM moderation_reports WHERE id IN (?,?)').bind(reportByOwner, reportOnOwner).first()).total, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM moderation_actions WHERE id IN (?,?)').bind('action_report_' + suffix, 'action_owned_' + suffix).first()).total, 0, 'Notes quoting an erased reporter are erased even when the moderator and target differ');
  assert.ok(await database.prepare('SELECT id FROM moderation_reports WHERE id = ?').bind(unrelatedReport).first());
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM auth_verification WHERE value = ?').bind(owner.id).first()).total, 0);
  const ledger = await database.prepare('SELECT * FROM account_erasure_ledger WHERE owner_id = ?').bind(owner.id).first();
  assert.deepEqual(Object.keys(ledger).sort(), ['expires_at', 'owner_id', 'requested_at']);
  assert.equal(ledger.expires_at - ledger.requested_at, 35 * 24 * 60 * 60000);
  for (const object of [book, image]) assert.equal(await bucket.head(object.key), null, 'Uploaded original and published image bytes are erased');
  await expect(await raw('/api/state', { headers: { Cookie: owner.cookie } }), 401, 'Old session loses private access');
  for (const path of ['/api/publications/' + pub, '/api/profiles/' + profile, '/api/journal/' + post, '/api/publications/' + pub + '/assets/' + image.id, '/api/profiles/' + profile + '/assets/' + image.id]) await expect(await raw(path), 404, 'Deleted public route stays unavailable');
  await expect(await raw('/api/auth/sign-in/username', options(null, { username: owner.username, password })), 401, 'Deleted account cannot sign in');
  await expect(await raw('/api/account/recover', options(null, { username: owner.username, recoveryKey: owner.key, newPassword: 'A new impossible recovery passphrase' })), 400, 'Deleted account cannot be recovered with its old key');
  await assert.rejects(database.prepare('INSERT INTO libraries (owner_id,state,version,updated_at) VALUES (?,?,1,?)').bind(owner.id, '{}', stamp).run(), /Account is unavailable/, 'An already-authenticated in-flight write cannot recreate an orphan library');
  await assert.rejects(database.prepare('INSERT INTO auth_verification (id,identifier,value,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('stale_reset_' + suffix, 'reset-password:stale-erased-' + suffix, owner.id, Date.now() + 60000, Date.now(), Date.now()).run(), /Account is unavailable/, 'An already-running reset request cannot recreate a token for an erased account');
  assert.ok(await bucket.head(untouched.key));
  assert.match((await database.prepare('SELECT state FROM libraries WHERE owner_id = ?').bind(other.id).first()).state, /keep this other library/);
  await expect(await raw('/api/assets/' + untouched.id, { headers: { Cookie: other.cookie } }), 200, 'Another account remains signed in with its files');
  report('Account deletion requires fresh authentication and explicit confirmation, erases D1/public/R2 data, prevents stale writes, and preserves unrelated accounts');

  const functions = await deletionFunctions();
  try {
    const retry = await signup('retry'), retryAsset = await asset(retry, 'Retry original.pdf');
    await database.prepare("UPDATE auth_account SET password = ? WHERE user_id = ? AND provider_id = 'credential'").bind(legacyHash, retry.id).run();
    // A suspended user must retain access to erase their own private data.
    await database.prepare('INSERT INTO account_suspensions (user_id,reason,created_at,moderator_id) VALUES (?,?,?,?)').bind(retry.id, 'Synthetic suspension', stamp, other.id).run();
    const failingBucket = new Proxy(bucket, { get(target, key) {
      if (key === 'delete') return async () => { throw new Error('Synthetic storage outage'); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const localBindings = { ...authBindings, DB: database, BUCKET: failingBucket };
    const accepted = await expect(await functions.deleteAccount(new Request(base + '/api/account/delete', options(retry, { ...body, currentPassword: 'legacyPass12' })), localBindings), 202, 'Storage failure retains a durable erasure job with a legacy current password');
    assert.deepEqual(await accepted.json(), { deleted: true, filesPending: true });
    assert.equal(await database.prepare('SELECT id FROM auth_user WHERE id = ?').bind(retry.id).first(), null, 'Storage failure never restores sign-in');
    assert.ok(await bucket.head(retryAsset.key), 'Fixture confirms the storage deletion failed');
    const obligation = await database.prepare('SELECT * FROM asset_transfers WHERE id = ?').bind(retryAsset.id).first();
    assert.equal(obligation.state, 'cleanup'); assert.equal(obligation.writer_done, 1);
    assert.equal((await database.prepare('SELECT attempts FROM account_deletion_jobs WHERE owner_id=?').bind(retry.id).first()).attempts, 1, 'Actual storage failure increments the retry counter');
    assert.equal('filename' in obligation, false, 'Pending erasure stores no filename');
    await expect(await raw('/api/assets/' + retryAsset.id, { headers: { Cookie: retry.cookie } }), 401, 'Pending file is inaccessible after acceptance');
    const cleaned = await functions.cleanupAccountDeletions({ ...localBindings, BUCKET: bucket }, { ownerId: retry.id, now: Date.now() + 125000 });
    assert.equal(cleaned.completed, 1);
    assert.equal(await bucket.head(retryAsset.key), null);
    assert.equal(await database.prepare('SELECT owner_id FROM account_deletion_jobs WHERE owner_id = ?').bind(retry.id).first(), null);
    assert.deepEqual(await functions.cleanupAccountDeletions({ ...localBindings, BUCKET: bucket }, { ownerId: retry.id, now: Date.now() + 250000 }), { processed: 0, completed: 0, pending: 0 }, 'Cleanup retries are idempotent');
    report('A suspended reader can delete their account; an injected R2 failure preserves only a durable cleanup obligation, which a later retry completes idempotently');

    const many = await signup('batch');
    for (let index = 0; index < 7; index++) await asset(many, 'Synthetic batch ' + index + '.pdf');
    await expect(await functions.deleteAccount(new Request(base + '/api/account/delete', options(many)), { ...authBindings, DB: database, BUCKET: bucket }), 202, 'A bounded first batch queues the remaining originals');
    const queued = await database.prepare('SELECT * FROM account_deletion_jobs WHERE owner_id=?').bind(many.id).first();
    assert.equal(queued.attempts, 0, 'Successful bounded work is not a storage failure');
    assert.equal(queued.next_attempt_at - queued.updated_at, 60_000);
    const nextBatch = await functions.cleanupAccountDeletions({ ...authBindings, DB: database, BUCKET: bucket }, { ownerId: many.id, transferLimit: 1, now: queued.next_attempt_at + 1 });
    assert.equal(nextBatch.pending, 1);
    const progressed = await database.prepare('SELECT * FROM account_deletion_jobs WHERE owner_id=?').bind(many.id).first();
    assert.equal(progressed.attempts, 0);
    assert.equal(progressed.next_attempt_at - progressed.updated_at, 60_000, 'Healthy progress never acquires exponential failure backoff');
    assert.equal((await functions.cleanupAccountDeletions({ ...authBindings, DB: database, BUCKET: bucket }, { ownerId: many.id, now: progressed.next_attempt_at + 1 })).completed, 1);
    report('Large account erasures make bounded progress without false failure counts or exponential backoff');
  } finally { functions.dispose(); }

  const racing = await signup('race');
  const race = await Promise.all([raw('/api/account/delete', options(racing)), raw('/api/account/delete', options(racing))]);
  assert.equal(race.filter(response => [200, 202].includes(response.status)).length, 1, 'Concurrent deletion has one acceptance');
  assert.ok(race.every(response => [200, 202, 401, 409].includes(response.status)));
  assert.equal(await database.prepare('SELECT id FROM auth_user WHERE id = ?').bind(racing.id).first(), null);
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM account_erasure_ledger WHERE owner_id = ?').bind(racing.id).first()).total, 1);
  const late = await signup('late'), lateId = 'as_' + crypto.randomUUID(), lateKey = 'private/' + lateId, now = Date.now();
  await database.prepare("INSERT INTO asset_transfers (id,owner_id,object_key,size,state,writer_done,created_at,updated_at,expires_at,next_attempt_at,attempts,lease_until) VALUES (?,?,?,20,'uploading',0,?,?,?,0,0,0)").bind(lateId, late.id, lateKey, now, now, now + 600000).run();
  await expect(await raw('/api/account/delete', options(late)), 200, 'Deletion cancels an unfinished upload');
  const marker = await bucket.head(lateKey); assert.equal(marker?.size, 0, 'Unfinished writer is sealed without retaining any book bytes');
  assert.deepEqual(marker?.customMetadata ?? {}, {});
  const latePut = await bucket.put(lateKey, 'must not reappear', { onlyIf: { etagDoesNotMatch: '*' } });
  assert.equal(latePut, null, 'A delayed conditional upload cannot recreate erased content');
  assert.equal((await bucket.head(lateKey))?.size, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS total FROM asset_transfers WHERE owner_id = ?').bind(late.id).first()).total, 0, 'Cancellation markers retain no account mapping');
  report('Concurrent deletions accept only once, and an unfinished upload cannot resurrect private bytes after account erasure');
}
