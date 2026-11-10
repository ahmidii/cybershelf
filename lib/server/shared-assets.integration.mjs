import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

/** Exact synthetic provider records. The harness intercepts only these URLs;
 * no reader data or request is sent to the real Open Library service. */
export function sharedAssetCatalogFixture(requestURL) {
  const url = new URL(requestURL);
  if (url.origin !== 'https://openlibrary.org' || !['/books/OL900000001M.json', '/isbn/9780140328721.json'].includes(url.pathname)) return null;
  return { key: '/books/OL900000001M', title: 'A synthetic community edition', works: [{ key: '/works/OL900000001W' }],
    isbn_13: ['9780140328721'], isbn_10: ['0140328726'], publishers: ['Local fixture press'], physical_format: 'Paperback' };
}
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4); return out; }
function png(color = 100) {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(27, color); for (const row of [0, 9, 18]) pixels[row] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Location\0PRIVATE_GPS_SENTINEL')), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export async function runSharedAssetsIntegration({ base, fetch: requestFetch, database, bucket, report = () => {} }) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10), accounts = new Map(); let address = 1;
  const password = 'A shared garden beside the quiet reading room';
  const expect = async (response, status, label) => { assert.equal(response.status, status, label + ': ' + (response.status === status ? '' : await response.clone().text())); return response; };
  const cookie = response => response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const call = (path, actor = 'alpha', init = {}) => {
    const account = actor ? accounts.get(actor) : null;
    return requestFetch(new URL(path, base).href, { ...init, headers: {
      ...(account ? { Cookie: account.cookie, 'X-Cybershelf-Account': account.id } : {}),
      ...((init.method ?? 'GET') === 'GET' ? {} : { Origin: new URL(base).origin }), 'cf-connecting-ip': '198.19.1.' + address++, ...(init.headers ?? {}),
    } });
  };
  const post = (path, body, actor = 'alpha', headers = {}) => call(path, actor, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  for (const actor of ['alpha', 'beta']) {
    const response = await expect(await post('/api/auth/sign-up/username', { username: 'shared_' + actor + '_' + suffix, password }, null), 200, 'Create shared-assets fixture reader');
    const data = await response.json(); accounts.set(actor, { id: data.user.id, cookie: cookie(response), username: data.user.username });
  }
  const signed = await expect(await post('/api/auth/sign-in/email', { email: 'moderator-fixture@example.invalid', password: 'legacyPass12' }, null), 200, 'Sign in as existing synthetic moderator');
  accounts.set('moderator', { id: 'moderator_fixture', cookie: cookie(signed) });
  const upload = async (color = 100) => {
    const form = new FormData(); form.set('kind', 'image'); form.set('file', new File([png(color)], 'PRIVATE_ORIGINAL_FILENAME.png', { type: 'image/png' }));
    return (await (await expect(await call('/api/assets', 'alpha', { method: 'POST', body: form }), 201, 'Upload private source photo')).json());
  };
  const source = await upload(), sourceTwo = await upload(170);
  const input = { assetId: source.id, kind: 'decor', title: 'Fixture garden plant', description: 'A deliberately contributed small plant.', creator: 'Fixture artist',
    tags: ['plant', 'garden'], category: 'plants', style: 'photographic', license: 'community-permission', defaultWidthMm: 60, defaultHeightMm: 100,
    rightsConfirmed: true, consent: 'community-assets-v1' };
  assert.equal((await post('/api/community-assets', input, null)).status, 401);
  assert.equal((await post('/api/community-assets', input, 'beta')).status, 404, 'Another reader cannot contribute a private image');
  assert.equal((await post('/api/community-assets', { ...input, consent: undefined })).status, 400);
  assert.equal((await post('/api/community-assets', { ...input, ownerId: accounts.get('beta').id })).status, 400);
  assert.equal((await post('/api/community-assets', input, 'alpha', { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await post('/api/community-assets', input, 'alpha', { 'X-Cybershelf-Account': accounts.get('beta').id })).status, 409);
  const created = await (await expect(await post('/api/community-assets', input), 201, 'Deliberately contribute a private image copy')).json(), decor = created.asset;
  assert.equal(decor.status, 'pending'); assert.equal(decor.origin, 'community'); assert.equal(decor.canWithdraw, true);
  assert.equal(decor.width, 2); assert.equal(decor.height, 3);
  const copy = await database.prepare('SELECT * FROM community_assets WHERE id=?').bind(decor.id).first();
  const original = await database.prepare('SELECT object_key FROM assets WHERE id=?').bind(source.id).first();
  assert.notEqual(copy.object_key, original.object_key, 'A contribution owns separate immutable bytes');
  const usage = await (await call('/api/assets')).json();
  const privateBytes = (await database.prepare('SELECT SUM(size) AS n FROM assets WHERE owner_id=?').bind(accounts.get('alpha').id).first()).n;
  assert.equal(usage.usedCount, 3, 'Two private uploads and one contributed copy share the account file allowance');
  assert.equal(usage.usedBytes, privateBytes + copy.size, 'Separate community bytes are included in the atomic storage allowance');
  assert.equal(usage.assets.length, 2, 'The shared copy is managed as a contribution rather than exposed as a private upload ID');
  assert.equal(Buffer.from(await (await bucket.get(copy.object_key)).arrayBuffer()).includes(Buffer.from('PRIVATE_GPS_SENTINEL')), false);
  assert.equal(Buffer.from(await (await bucket.get(original.object_key)).arrayBuffer()).includes(Buffer.from('PRIVATE_GPS_SENTINEL')), true, 'The private original is unchanged');
  assert.equal((await call(decor.imageUrl, null)).status, 404); assert.equal((await call(decor.imageUrl, 'beta')).status, 404);
  const pendingImage = await expect(await requestFetch(new URL(decor.imageUrl, base).href, { headers: { Cookie: accounts.get('alpha').cookie } }), 200, 'Pending owner image loads with an ordinary img session');
  assert.equal(pendingImage.headers.get('Cache-Control'), 'no-store');
  assert.equal(pendingImage.headers.get('Content-Disposition').includes('PRIVATE_'), false);
  assert.equal((await call(source.url, 'beta')).status, 404);
  assert.equal((await (await call('/api/community-assets?origin=community&q=fixture', null)).json()).assets.length, 0);
  assert.equal((await (await call('/api/community-assets?mine=true')).json()).assets.length, 1);
  assert.equal((await (await call('/api/community-assets?mine=true', 'beta')).json()).assets.length, 0);
  assert.equal((await call('/api/community-assets/moderation', 'beta')).status, 403);
  assert.equal((await post('/api/community-assets/' + decor.id + '/review', { action: 'approve', note: 'Looks appropriate.' }, 'beta')).status, 403);
  const duplicate = await (await expect(await post('/api/community-assets', input), 201, 'Retry a contribution')).json();
  assert.equal(duplicate.asset.id, decor.id); assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM community_assets WHERE contributor_id=?').bind(accounts.get('alpha').id).first()).n, 1);
  report('Shared contributions require explicit permission, owner-scoped uploads and account-safe requests; metadata is stripped from an independent private pending copy');

  const approve = async asset => (await (await expect(await post('/api/community-assets/' + asset.id + '/review', { action: 'approve', note: 'Reviewed source, presentation and permissions.' }, 'moderator'), 200, 'Approve a reviewed contribution')).json()).asset;
  await approve(decor);
  const publicAsset = (await (await expect(await call('/api/community-assets/' + decor.id, 'beta'), 200, 'Another reader discovers approved decoration')).json()).asset;
  for (const secret of [accounts.get('alpha').id, source.id, original.object_key, copy.object_key, 'PRIVATE_ORIGINAL_FILENAME', 'PRIVATE_GPS_SENTINEL']) assert.equal(JSON.stringify(publicAsset).includes(secret), false, 'Public catalogue excludes ' + secret);
  assert.equal(publicAsset.canWithdraw, undefined); assert.equal(publicAsset.reviewNote, undefined);
  assert.equal((await call(decor.imageUrl, 'beta')).status, 200); assert.equal((await call(decor.imageUrl, null)).status, 200);
  const curated = (await (await expect(await call('/api/community-assets?origin=curated', null), 200, 'Search curated assets through shared catalogue')).json()).assets;
  assert.ok(curated.length > 0); assert.equal(curated[0].origin, 'curated'); assert.match(curated[0].imageUrl, /^\/api\/community-assets\/dc_.*\/image$/);
  assert.equal((await call(curated[0].imageUrl, null)).status, 200, 'Curated objects use the canonical shared image route');
  const stamp = new Date().toISOString(), state = { schemaVersion: 1, profile: { name: 'Shared beta', bio: '' }, books: [], shelves: [{ id: 'shared_beta_shelf', title: 'A shared garden', description: '',
    bookcase: 'open', layout: 'balanced', finish: 'paper', updatedAt: stamp, items: [{ id: 'shared_beta_decor', kind: 'decor', decor: 'image', sharedAssetId: decor.id, imageUrl: decor.imageUrl, label: decor.title,
      decorWidthMm: decor.defaultWidthMm, decorHeightMm: decor.defaultHeightMm, slot: 0, pinned: false, facing: 'auto' }] }] };
  await expect(await call('/api/state', 'beta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, version: 0 }) }), 200, 'Save another reader’s shared decoration reference');
  const savedState = await (await call('/api/state', 'beta')).json(); assert.equal(savedState.state.shelves[0].items[0].sharedAssetId, decor.id);
  const publication = await (await expect(await post('/api/publications', { shelfId: 'shared_beta_shelf' }, 'beta'), 201, 'Publish a shelf using another reader’s approved decoration')).json();
  const shared = await (await expect(await call('/api/publications/' + publication.id, null), 200, 'Fetch public shelf with shared artwork')).json();
  assert.ok(JSON.stringify(shared).includes(decor.imageUrl));
  report('Approved community and curated decorations share one searchable API and work across independent readers, saved libraries and published shelves');

  const edition = { catalogId: 'OL900000001W', editionId: 'OL900000001M', isbn: '9780140328721', variant: 'Original paperback' };
  const spineInput = { ...input, kind: 'spine', title: 'Fixture paperback spine', category: 'books', edition };
  assert.equal((await post('/api/community-assets', { ...spineInput, license: 'CC0-1.0' })).status, 400, 'Publisher artwork is not relabelled as uploader-owned CC0');
  assert.equal((await post('/api/community-assets', { ...spineInput, edition: { ...edition, catalogId: 'OL900000002W' } })).status, 400);
  assert.equal((await post('/api/community-assets', { ...spineInput, edition: { ...edition, isbn: '9780980200447' } })).status, 400);
  const spine = (await (await expect(await post('/api/community-assets', spineInput), 201, 'Contribute verified edition spine')).json()).asset;
  const identities = [{ id: 'matching', ...edition }, { id: 'isbn_ten', isbn: '0140328726' }, { id: 'other_edition', ...edition, editionId: 'OL900000002M' },
    { id: 'wrong_isbn', ...edition, isbn: '9780980200447' }, { id: 'work_only', catalogId: edition.catalogId }].map(({ variant, ...book }) => book);
  const resolve = async () => (await (await expect(await post('/api/community-assets/resolve', { books: identities }, 'beta'), 200, 'Resolve another reader’s edition artwork')).json()).matches;
  assert.equal((await resolve())[0].spine, undefined, 'Pending spine is not a public default');
  await approve(spine);
  let matches = await resolve(); assert.equal(matches[0].spine.id, spine.id); assert.equal(matches[1].spine.id, spine.id);
  for (const match of matches.slice(2)) assert.equal(match.spine, undefined, 'Conflicting or work-only identity does not borrow a spine');
  const cover = (await (await expect(await post('/api/community-assets', { ...spineInput, kind: 'cover', title: 'Fixture paperback cover' }), 201, 'Contribute book cover through same asset system')).json()).asset;
  await approve(cover); assert.equal((await resolve())[0].cover.id, cover.id);
  const alternate = (await (await expect(await post('/api/community-assets', { ...spineInput, assetId: sourceTwo.id, edition: { ...edition, variant: 'Later jacket printing' } }), 201, 'Contribute another artwork variant')).json()).asset;
  await approve(alternate); matches = await resolve(); assert.equal(matches[0].spine, undefined); assert.equal(matches[0].alternatives.filter(asset => asset.kind === 'spine').length, 2);
  report('Book artwork is provider-verified by edition/ISBN, reuses equivalent ISBN-10/13 across readers, rejects conflicts, and exposes alternate printings without silently choosing a winner');

  await expect(await post('/api/reports', { kind: 'asset', targetId: spine.id, reason: 'other', details: 'Synthetic wrong-edition report.' }, 'beta'), 202, 'Report a shared spine');
  const queue = await (await call('/api/moderation', 'moderator')).json(), assetReport = queue.items.find(item => item.targetId === spine.id);
  assert.ok(assetReport); const act = action => post('/api/moderation/' + assetReport.id, { action, note: 'Synthetic shared-asset review.' }, 'moderator');
  await expect(await act('hide'), 200, 'Hide reported community artwork'); assert.equal((await call(spine.imageUrl, null)).status, 404);
  assert.equal((await resolve())[0].alternatives.some(asset => asset.id === spine.id), false);
  await expect(await act('restore'), 200, 'Restore reviewed community artwork'); assert.equal((await call(spine.imageUrl, null)).status, 200);
  await expect(await post('/api/blocks', { kind: 'asset', targetId: spine.id }, 'beta'), 200, 'Block a shared asset contributor');
  assert.equal((await call(spine.imageUrl, 'beta')).status, 404); assert.equal((await call(spine.imageUrl, null)).status, 200);
  const blocks = await (await call('/api/blocks', 'beta')).json();
  await expect(await call('/api/blocks/' + blocks.items[0].id, 'beta', { method: 'DELETE' }), 200, 'Unblock fixture contributor');
  assert.equal((await call('/api/community-assets/' + spine.id, 'beta', { method: 'DELETE' })).status, 404);
  await expect(await call('/api/community-assets/' + decor.id, 'alpha', { method: 'DELETE' }), 200, 'Withdraw contributed decoration');
  assert.equal((await call(decor.imageUrl, 'beta')).status, 404, 'Existing references revoke together on withdrawal');
  assert.equal(await bucket.get(copy.object_key), null); assert.ok(await bucket.get(original.object_key), 'Withdrawal leaves the private source intact');
  assert.ok(await database.prepare('SELECT asset_id FROM community_asset_erasures WHERE asset_id=?').bind(decor.id).first());
  report('Shared artwork reports, reciprocal blocks and moderator hide/restore are enforced on image routes; withdrawal revokes all references and queues separate-copy erasure');

  const pending = (await (await expect(await post('/api/community-assets', { ...input, assetId: sourceTwo.id, title: 'A pending second decoration' }), 201, 'Prepare a pending deletion fixture')).json()).asset;
  const pendingRow = await database.prepare('SELECT object_key FROM community_assets WHERE id=?').bind(pending.id).first();
  await expect(await act('hide'), 200, 'Keep one approved spine hidden across account deletion');
  const deletion = await post('/api/account/delete', { currentPassword: password, confirmation: 'DELETE' });
  assert.ok([200, 202].includes(deletion.status), 'Account deletion retains explicit approved contributions: ' + await deletion.clone().text());
  assert.equal(await database.prepare('SELECT id FROM community_assets WHERE id=?').bind(pending.id).first(), null);
  assert.equal((await database.prepare('SELECT contributor_id FROM community_assets WHERE id=?').bind(cover.id).first()).contributor_id, null);
  assert.equal((await call(cover.imageUrl, null)).status, 200, 'Approved deliberately shared copy survives with contributor detached');
  assert.equal((await call(spine.imageUrl, null)).status, 404, 'Contributor deletion does not undo moderation hiding');
  assert.equal((await call(pending.imageUrl, null)).status, 404);
  const pendingObject = await bucket.get(pendingRow.object_key); assert.ok(!pendingObject || pendingObject.size === 0, 'Unapproved contribution bytes are removed with the account');
  assert.equal((await call(source.url, 'alpha')).status, 401);
  report('Account deletion erases private and pending copies, detaches explicitly retained approved contributions, and preserves independent moderation restrictions');

  // A historical second reviewer may no longer be configured as a moderator.
  // Seed that existing audit state, then exercise actual account deletion.
  // Equal timestamps ensure redaction follows the latest inserted review.
  const coverReview = await database.prepare('SELECT created_at FROM community_asset_reviews WHERE asset_id=? ORDER BY rowid DESC LIMIT 1').bind(cover.id).first();
  const laterNote = 'A later independent reviewer confirmed this edition.';
  await database.batch([
    database.prepare("INSERT INTO community_asset_reviews (id,asset_id,moderator_id,action,note,created_at) VALUES (?,?,?,'approved',?,?)")
      .bind('car_later_' + suffix, cover.id, accounts.get('beta').id, laterNote, coverReview.created_at),
    database.prepare('UPDATE community_assets SET review_note=? WHERE id=?').bind(laterNote, cover.id),
  ]);
  const moderatorDeletion = await post('/api/account/delete', { currentPassword: 'legacyPass12', confirmation: 'DELETE' }, 'moderator');
  assert.ok([200, 202].includes(moderatorDeletion.status), 'Delete a synthetic reviewer: ' + await moderatorDeletion.clone().text());
  assert.equal((await database.prepare('SELECT review_note FROM community_assets WHERE id=?').bind(spine.id).first()).review_note, 'Reviewer account deleted.', 'Latest deleted reviewer note is removed from the denormalized catalogue row');
  assert.equal((await database.prepare('SELECT review_note FROM community_assets WHERE id=?').bind(cover.id).first()).review_note, laterNote, 'Deleting an earlier reviewer preserves the later independent review note');
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM community_asset_reviews WHERE moderator_id='moderator_fixture'").first()).n, 0);
  assert.equal((await call(cover.imageUrl, null)).status, 200); assert.equal((await call(spine.imageUrl, null)).status, 404, 'Reviewer deletion preserves the moderation decision');
  report('Reviewer deletion redacts historical and current authored notes while preserving later independent reviews, shared bytes and moderation decisions');
}
