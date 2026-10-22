import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runProfileIntegration } from './profiles.integration.mjs';
import { runJournalIntegration } from './journal.integration.mjs';
import { runFeedIntegration } from './feed.integration.mjs';

/** Shared by the local-preview check and the isolated workerd harness. */
export async function runIntegration({ base, fetch: requestFetch = fetch, report = () => {} }) {
  const suffix = crypto.randomUUID();
  const password = 'A local-only integration passphrase 2026';
  const accounts = new Map();
  const origin = new URL(base).origin;
  const raw = (path, init = {}) => requestFetch(new URL(path, base).href, init);
  const authCall = (path, body, cookie = '', extraHeaders = {}) => raw('/api/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': '192.0.2.10', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
  const cookieFrom = (response) => response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const call = (path, account, init = {}) => {
    const identity = account ? accounts.get(account) : undefined;
    const method = init.method ?? 'GET';
    return raw(path, {
      ...init,
      headers: {
        ...(identity ? { Cookie: identity.cookie, 'X-Cybershelf-Account': identity.id } : {}),
        ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: origin }),
        ...(init.headers ?? {}),
      },
    });
  };
  const expectStatus = async (response, status, message) => {
    assert.equal(response.status, status, `${message}: ${response.status === status ? '' : await response.clone().text()}`);
    return response;
  };

  assert.equal((await raw('/api/state')).status, 401);
  assert.equal((await raw('/api/state', { headers: {
    'oai-authenticated-user-id': 'forged-reader', 'oai-authenticated-user-email': 'forged@example.invalid',
  } })).status, 401, 'Raw caller identity headers never authenticate');
  const crossSite = await authCall('sign-in/email', { email: 'nobody@example.invalid', password }, '', {
    Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site',
  });
  assert.equal(crossSite.status, 403, 'Cross-origin authentication is rejected');

  for (const name of ['owner', 'other']) {
    const email = `${name}-${suffix}@example.invalid`;
    const response = await expectStatus(await authCall('sign-up/email', { name: 'Integration reader', email, password }), 200, 'Account creation');
    const account = await response.json();
    assert.equal(account.user.emailVerified, false, 'Signup does not claim that an address is verified');
    const cookie = cookieFrom(response);
    assert.ok(cookie.includes('cybershelf.session_token='), 'Signup must return a session cookie');
    const sessionCookie = response.headers.getSetCookie().find(value => value.includes('cybershelf.session_token='));
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Lax/i);
    if (origin.startsWith('https:')) assert.match(sessionCookie, /; Secure/i);
    accounts.set(name, { id: account.user.id, cookie, email });
  }
  const owner = accounts.get('owner');
  const other = accounts.get('other');
  assert.notEqual(owner.id, other.id);
  const wrongPassword = await authCall('sign-in/email', { email: owner.email, password: 'This is the wrong passphrase' });
  assert.equal(wrongPassword.status, 401, 'A wrong password does not create a session');
  assert.equal(cookieFrom(wrongPassword).includes('cybershelf.session_token='), false);
  const signIn = await expectStatus(await authCall('sign-in/email', { email: owner.email, password, rememberMe: true }), 200, 'Password sign-in');
  owner.cookie = cookieFrom(signIn);
  const session = await expectStatus(await call('/api/auth/get-session', 'owner'), 200, 'Session lookup');
  assert.equal((await session.json()).user.id, owner.id);
  const initial = await expectStatus(await call('/api/state', 'owner'), 200, 'New library');
  const initialData = await initial.json();
  assert.equal(initialData.state, null);
  assert.equal(initialData.user.id, owner.id);
  report('Signup, password checks, secure session cookies, CSRF and forged-header rejection');

  const empty = { schemaVersion: 1, profile: { name: 'Integration reader', bio: '' }, books: [], shelves: [] };
  const save = (state, version, account = 'owner', headers = {}) => call('/api/state', account, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ state, version }),
  });
  let fileId, imageId, pubId, profileId, version = 0;
  try {
    assert.equal((await save(empty, 0, 'other', { 'X-Cybershelf-Account': owner.id })).status, 409, 'An old tab cannot write one reader’s library into another account');
    assert.equal((await save(empty, 0, 'owner', { 'X-Cybershelf-Account': '' })).status, 409, 'Private writes require an account precondition');
    assert.equal((await (await call('/api/state', 'other')).json()).state, null, 'Rejected account switch has no write side effect');
    assert.equal((await call('/api/state', 'other', { headers: { 'X-Cybershelf-Account': owner.id } })).status, 409);
    for (const [path, method] of [['/api/assets', 'POST'], ['/api/publications', 'POST'], ['/api/profile','POST'], ['/api/profile','DELETE'], ['/api/journal','POST'], ['/api/journal/missing','DELETE'], ['/api/journal/missing/comments','POST'], ['/api/journal/missing/comments/missing','DELETE'], ['/api/assets/missing', 'DELETE'], ['/api/publications/missing', 'DELETE']]) {
      assert.equal((await call(path, 'other', { method, headers: { 'X-Cybershelf-Account': owner.id } })).status, 409, `${method} ${path} rejects an account switch before parsing or writing`);
    }
    const upload = new FormData();
    upload.set('kind', 'book');
    upload.set('file', new File(['%PDF-1.7\nprivate-original'], 'private.pdf', { type: 'application/pdf' }));
    const uploaded = await expectStatus(await call('/api/assets', 'owner', { method: 'POST', body: upload }), 201, 'Private book upload');
    fileId = (await uploaded.json()).id;
    assert.equal((await call('/api/assets/' + fileId, null)).status, 401);
    assert.equal((await call('/api/assets/' + fileId, 'other')).status, 404);
    assert.equal(await (await call('/api/assets/' + fileId, 'owner')).text(), '%PDF-1.7\nprivate-original');
    assert.equal((await raw('/api/assets/' + fileId, { headers: { Cookie: owner.cookie } })).status, 200, 'Direct downloads need the session cookie, without a custom header');
    const image = new FormData();
    image.set('kind', 'image');
    image.set('file', new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'private-cover.png', { type: 'image/png' }));
    const imageResponse = await expectStatus(await call('/api/assets', 'owner', { method: 'POST', body: image }), 201, 'Private cover upload');
    imageId = (await imageResponse.json()).id;
    const state = {
      ...empty,
      books: [{ id: 'book1', title: 'Book', author: 'Author', coverUrl: '/api/assets/' + imageId, color: '#aabbcc', status: 'reading', progress: 22, rating: 4, review: 'secret-review', notes: 'secret-note', addedAt: new Date().toISOString(), sources: [{ id: 'source1', kind: 'file', label: 'Private PDF', assetId: fileId }] }],
      shelves: [{ id: 'shelf1', title: 'Shared shelf', description: 'Public description', bookcase: 'open', layout: 'gallery', finish: 'paper', updatedAt: new Date().toISOString(), items: [
        { id: 'item1', kind: 'book', bookId: 'book1', slot: 100, pinned: false, facing: 'stack', placement: { row: 1, x: .4137 } },
        { id: 'placement_top', kind: 'book', bookId: 'book1', slot: 101, pinned: false, facing: 'stack', placement: { row: 1, x: .4137, supportId: 'item1' } },
      ] }],
    };
    const saved = await expectStatus(await save(state, 0), 200, 'Save library');
    version = (await saved.json()).version;
    assert.equal(version, 1);
    const persisted = await (await expectStatus(await call('/api/state', 'owner'), 200, 'Read continuous shelf positions')).json();
    assert.equal(persisted.version, version);
    assert.deepEqual(persisted.state.shelves[0].items, state.shelves[0].items, 'State round-trip preserves exact coordinates, identifiers beyond the old gallery capacity, and stack support');
    const stalePlacement = structuredClone(state);
    stalePlacement.shelves[0].items[0].placement.x = .82;
    assert.equal((await save(stalePlacement, 0)).status, 409, 'Concurrent stale placement revisions do not overwrite the library');
    const missingSupport = structuredClone(state);
    missingSupport.shelves[0].items[1].placement.supportId = 'missing_support';
    assert.equal((await save(missingSupport, version)).status, 400, 'A dangling support is rejected before a library write');
    const afterRejectedPlacements = await (await call('/api/state', 'owner')).json();
    assert.equal(afterRejectedPlacements.version, version, 'Invalid and stale placements do not increment the saved revision');
    assert.deepEqual(afterRejectedPlacements.state.shelves[0].items, state.shelves[0].items, 'Rejected saves leave the existing continuous arrangement intact');
    assert.equal((await save(state, 0, 'other')).status, 400, 'Another account cannot adopt private file references');
    assert.equal((await call('/api/assets/' + fileId, 'owner', { headers: { 'X-Cybershelf-Account': other.id } })).status, 409);
    report('Two-account state isolation, stale-tab protection, private R2 originals and revision conflicts');
    const publication = await expectStatus(await call('/api/publications', 'owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shelfId: 'shelf1' }) }), 201, 'Publish shelf');
    pubId = (await publication.json()).id;
    const snapshot = await expectStatus(await call('/api/publications/' + pubId, null), 200, 'Read public shelf');
    const publicText = await snapshot.text();
    const publicPlacementItems = JSON.parse(publicText).shelf.items;
    assert.deepEqual(publicPlacementItems.map(item => ({ id: item.id, slot: item.slot, placement: item.placement })),
      state.shelves[0].items.map(item => ({ id: item.id, slot: item.slot, placement: item.placement })),
      'Published shelves preserve continuous coordinates and the two-book stack');
    for (const privateValue of [fileId, 'secret-review', 'secret-note', 'Private PDF']) assert.equal(publicText.includes(privateValue), false, privateValue);
    const publicImage = await expectStatus(await call(`/api/publications/${pubId}/assets/${imageId}`, null), 200, 'Public cover image');
    assert.equal(publicImage.headers.get('content-disposition').includes('private-cover'), false);
    assert.equal((await call(`/api/publications/${pubId}/assets/${fileId}`, null)).status, 404, 'Book files never become publication assets');
    assert.equal((await call('/api/publications/' + pubId, 'other', { method: 'DELETE' })).status, 404);
    assert.equal((await call('/api/assets/' + fileId, 'owner', { method: 'DELETE' })).status, 409, 'Referenced originals cannot be silently deleted');
    ({version,profileId}=await runProfileIntegration({state,version,call,save,expectStatus,imageId,fileId,pubId,ownerId:owner.id,report,onVersion:value=>{version=value;}}));
    const placementProfile = await (await expectStatus(await call('/api/profiles/' + profileId, null), 200, 'Read featured shelf positions')).json();
    assert.deepEqual(placementProfile.featured.shelf.items.map(item => ({ id: item.id, slot: item.slot, placement: item.placement })),
      state.shelves[0].items.map(item => ({ id: item.id, slot: item.slot, placement: item.placement })),
      'Featured profile snapshots preserve exact coordinates and support IDs through publication updates');
    report('Continuous shelf positions: private persistence, legacy-capacity removal, stack supports, rejected stale/invalid saves and public shelf/profile snapshots');
    ({version,profileId}=await runJournalIntegration({version,profileId,call,save,expectStatus,ownerId:owner.id,otherId:other.id,imageId,fileId,report,onVersion:value=>{version=value;}}));
    ({version,profileId}=await runFeedIntegration({call,save,expectStatus,ownerId:owner.id,otherId:other.id,report,onVersion:value=>{version=value;}}));
    await expectStatus(await call('/api/publications/' + pubId, 'owner', { method: 'DELETE' }), 200, 'Unpublish shelf');
    pubId = undefined;
    assert.equal((await call(JSON.parse(publicText).books[0].coverUrl, null)).status, 404, 'Unpublishing revokes the public image URL');
    assert.equal((await call('/api/profiles/'+profileId,null)).status,404,'Unpublishing a shared shelf also revokes a profile featuring it');
    assert.equal((await call(`/api/profiles/${profileId}/assets/${imageId}`,null)).status,404);
    report('Public shelf redaction, original-file exclusion and publication revocation');
  } finally {
    if (pubId) await call('/api/publications/' + pubId, 'owner', { method: 'DELETE' });
    await call('/api/profile','owner',{method:'DELETE'});
    if (version) await expectStatus(await save(empty, version), 200, 'Clear test library');
    for (const id of [fileId, imageId]) if (id) await call('/api/assets/' + id, 'owner', { method: 'DELETE' });
  }
  assert.equal((await authCall('sign-out', {}, owner.cookie, { 'X-Cybershelf-Account': other.id })).status, 409, 'A stale tab cannot sign out a different account');
  await expectStatus(await authCall('sign-out', {}, owner.cookie, { 'X-Cybershelf-Account': owner.id }), 200, 'Sign out');
  assert.equal((await call('/api/state', 'owner')).status, 401, 'Replaying a revoked session does not restore account access');
  const attempts = await Promise.all(Array.from({ length: 11 }, () => authCall('sign-in/email', {
    // Validation rejects before password hashing; the real database rate limit
    // still has to atomically count and stop these concurrent requests.
    email: 'not-an-email', password,
  }, '', { 'cf-connecting-ip': '192.0.2.99' })));
  assert.ok(attempts.some(response => response.status === 429), 'Concurrent sign-in attempts are limited by shared D1 state');
  for (const response of attempts) assert.ok([400, 429].includes(response.status), `Unexpected rate-limit response: ${response.status}`);
  report('Session revocation and concurrent database-backed authentication rate limiting');
}

// This optional path is only for a developer's local preview. The standard
// test:worker command uses ephemeral workerd storage and needs no server.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.CYBERSHELF_TEST_BASE_URL;
  if (base && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(base)) throw new Error('Integration fixtures may only run against a local preview.');
  test('authenticated private state, originals and publication boundaries', { skip: !base }, () => runIntegration({ base }));
}
