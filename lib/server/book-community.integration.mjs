import assert from 'node:assert/strict';

/** Real Worker/D1 integration. Accounts, catalog text and activity are synthetic;
 * Open Library is never contacted by this fixture. */
export async function runBookCommunityIntegration({ base, fetch: requestFetch, database, report = () => {} }) {
  const origin = new URL(base).origin, suffix = crypto.randomUUID(), accounts = new Map();
  const expect = async (response, status, label) => {
    assert.equal(response.status, status, `${label}: ${response.status === status ? '' : await response.clone().text()}`);
    return response;
  };
  const call = (path, actor = 'alpha', init = {}) => {
    const account = actor ? accounts.get(actor) : undefined;
    return requestFetch(new URL(path, base).href, { ...init, headers: {
      ...(account ? { Cookie: account.cookie, 'X-Cybershelf-Account': account.id } : {}),
      ...((init.method ?? 'GET') === 'GET' ? {} : { Origin: origin }), ...(init.headers ?? {}),
    } });
  };
  const send = (path, method, body, actor = 'alpha', headers = {}) => call(path, actor, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  for (const actor of ['alpha', 'beta']) {
    const response = await expect(await send('/api/auth/sign-up/email', 'POST', {
      name: 'Community ' + actor, email: `community-${actor}-${suffix}@example.invalid`, password: 'An ephemeral community passphrase 2026',
    }, null, { 'cf-connecting-ip': '192.0.2.74' }), 200, 'Create community fixture account');
    const data = await response.json();
    accounts.set(actor, { id: data.user.id, cookie: response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; '), version: 0 });
  }
  const stamp = '2026-10-01T00:00:00.000Z';
  const makeBook = (id, title, author) => ({ id, title, author, coverUrl: 'https://example.invalid/COMMUNITY_PRIVATE_COVER.jpg', color: '#879479',
    status: 'read', progress: 100, rating: 5, review: 'COMMUNITY_PRIVATE_REVIEW', notes: 'COMMUNITY_PRIVATE_NOTES', addedAt: stamp,
    sources: [{ id: id + '_source', kind: 'link', label: 'COMMUNITY_PRIVATE_PLATFORM', url: 'https://example.invalid/COMMUNITY_PRIVATE_SOURCE' }],
    readingLog: [0, 1].map(index => ({ id: id + '_entry_' + index, body: 'COMMUNITY_PRIVATE_THOUGHT_' + index, progress: 100, createdAt: stamp })),
  });
  const shelf = { id: 'community_shelf', title: 'Public shelf', description: '', bookcase: 'open', layout: 'balanced', finish: 'paper', items: [], updatedAt: stamp };
  const states = Object.fromEntries(['alpha', 'beta'].map(actor => [actor, {
    schemaVersion: 1, profile: { name: 'Community ' + actor, bio: '', featuredShelfId: shelf.id },
    books: [makeBook(actor + '_book', actor === 'alpha' ? 'Café  Editions' : 'ＣＡＦÉ\teditions', actor === 'alpha' ? 'A. Writer' : ' a. writer ')], shelves: [structuredClone(shelf)],
  }]));
  const save = async actor => {
    const account = accounts.get(actor);
    const result = await (await expect(await send('/api/state', 'PUT', { state: states[actor], version: account.version }, actor), 200, 'Save community fixture Library')).json();
    account.version = result.version;
  };
  for (const actor of ['alpha', 'beta']) await save(actor);
  assert.equal((await send('/api/books/register', 'POST', { bookId: 'alpha_book' }, null)).status, 401);
  assert.equal((await send('/api/books/register', 'POST', { bookId: 'alpha_book' }, 'beta')).status, 404, 'Another account cannot register a private book by ID');
  assert.equal((await send('/api/books/register', 'POST', { bookId: 'alpha_book' }, 'alpha', { 'X-Cybershelf-Account': accounts.get('beta').id })).status, 409);
  assert.equal((await send('/api/books/register', 'POST', { bookId: 'alpha_book' }, 'alpha', { Origin: 'https://attacker.invalid' })).status, 403);
  const registered = await (await expect(await send('/api/books/register', 'POST', { bookId: 'alpha_book' }), 201, 'Explicitly create a minimal community page')).json();
  const id = registered.id, path = '/api/books/' + id + '/community';
  assert.match(id, /^cs_[a-f0-9]{64}$/);
  const duplicate = await (await expect(await send('/api/books/register', 'POST', { bookId: 'beta_book' }, 'beta'), 201, 'Register matching normalized bibliographic text')).json();
  assert.equal(duplicate.id, id, 'Manual identity is deterministic across case, Unicode width and whitespace');
  const stored = await database.prepare('SELECT * FROM community_books WHERE id = ?').bind(id).first();
  assert.deepEqual(Object.keys(stored).sort(), ['author', 'created_at', 'id', 'title']);
  const publicPage = await (await expect(await call('/api/books/' + id, null), 200, 'Public community catalog page')).json();
  assert.equal(publicPage.book.source, 'community'); assert.equal(publicPage.book.coverUrl, ''); assert.deepEqual(publicPage.book.editions, []);
  const savedLibrary = await (await call('/api/state')).json();
  assert.equal(savedLibrary.state.books[0].catalogId, undefined, 'Registration does not silently edit the private Library');
  const stats = async workId => (await (await expect(await call('/api/books/' + (workId ?? id) + '/community', null), 200, 'Read public aggregate')).json()).stats;
  const mine = async actor => (await (await expect(await call(path + '/me', actor), 200, 'Read own community contributions')).json());
  assert.deepEqual(await stats(), { averageRating: null, ratingCount: 0, readCount: 0, readerCount: 0 }, 'Private completed books, ratings and notes do not enter aggregates');
  for (const response of [registered, publicPage, await stats()]) {
    const output = JSON.stringify(response);
    for (const privateValue of ['COMMUNITY_PRIVATE_', accounts.get('alpha').id, accounts.get('beta').id, 'alpha_book', 'beta_book']) assert.equal(output.includes(privateValue), false, privateValue);
  }
  assert.equal((await call(path + '/me', null)).status, 401);
  assert.equal((await call(path + '/me', 'alpha', { headers: { 'X-Cybershelf-Account': accounts.get('beta').id } })).status, 409);
  for (const invalid of ['OL0W', 'OL123M', 'cs_bad', 'not_a_work']) assert.equal((await call('/api/books/' + invalid + '/community', null)).status, 404);
  assert.equal((await call('/api/books/cs_' + 'f'.repeat(64) + '/community', null)).status, 404);
  const rate = (rating, actor = 'alpha', headers) => send(path + '/rating', 'PUT', { rating }, actor, headers);
  assert.equal((await rate(4, null)).status, 401);
  assert.equal((await rate(4, 'alpha', { 'X-Cybershelf-Account': accounts.get('beta').id })).status, 409);
  assert.equal((await rate(4, 'alpha', { Origin: 'https://attacker.invalid' })).status, 403);
  for (const rating of [0, -1, 5.5, 2.3, '4']) assert.equal((await rate(rating)).status, 400);
  await expect(await rate(4.5), 200, 'Explicit community rating');
  await expect(await rate(2.5, 'beta'), 200, 'Second reader rating');
  assert.deepEqual(await stats(), { averageRating: 3.5, ratingCount: 2, readCount: 0, readerCount: 0 });
  await expect(await rate(5), 200, 'Replace one rating across all editions');
  assert.equal((await stats()).averageRating, 3.75); assert.equal((await stats()).ratingCount, 2);
  await expect(await rate(null, 'beta'), 200, 'Remove a community rating');
  assert.equal((await stats()).averageRating, 5); assert.equal((await mine('beta')).rating, null);
  assert.equal((await mine('alpha')).rating, 5);
  const addRead = (readId, finishedAt, actor = 'alpha') => send(path + '/reads', 'POST', { id: readId, finishedAt }, actor);
  for (const date of ['2026-02-31', '2025-02-29', '2026-10-01T00:00:00Z', '9999-01-01']) assert.equal((await addRead('invalid_date', date)).status, 400);
  await expect(await addRead('read_one', '2026-10-01'), 201, 'Log an explicit completed read');
  await expect(await addRead('read_one', '2026-10-01'), 200, 'Retry the same completed-read ID');
  await expect(await addRead('duplicate_day', '2026-10-01'), 200, 'Repeated date does not count twice');
  assert.equal((await mine('alpha')).reads.length, 1); assert.equal((await mine('alpha')).reads[0].id, 'read_one');
  await expect(await addRead('read_two', '2026-10-02'), 201, 'Log a deliberate reread');
  await expect(await addRead('read_one', '2026-10-01', 'beta'), 201, 'Read IDs are scoped to their owner');
  assert.deepEqual(await stats(), { averageRating: 5, ratingCount: 1, readCount: 3, readerCount: 2 });
  assert.equal((await addRead('read_one', '2026-10-03')).status, 409, 'An existing read ID cannot be rebound');
  const concurrent = await Promise.all([addRead('concurrent_a', '2026-10-03'), addRead('concurrent_b', '2026-10-03')]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 201]);
  assert.equal((await stats()).readCount, 4, 'A concurrent duplicate date produces one completed read');
  await expect(await call(path + '/reads/read_two', 'beta', { method: 'DELETE' }), 200, 'Another reader cannot delete an owner’s completion');
  assert.equal((await stats()).readCount, 4);
  await expect(await call(path + '/reads/read_one', 'beta', { method: 'DELETE' }), 200, 'Delete own completion');
  await expect(await call(path + '/reads/read_one', 'beta', { method: 'DELETE' }), 200, 'Deletion retry is idempotent');
  assert.equal((await stats()).readCount, 3); assert.equal((await stats()).readerCount, 1);

  const publish = async actor => {
    const profile = states[actor].profile;
    return (await (await expect(await send('/api/profile', 'POST', { shelfId: shelf.id, shelfUpdatedAt: stamp, name: profile.name, bio: profile.bio }, actor), 201, 'Explicitly publish a fixture profile')).json()).profile;
  };
  const share = async (actor, bookId, entryId, status = 201) => (await (await expect(await send('/api/journal', 'POST', { bookId, entryId }, actor), status, 'Explicitly share a completed journal entry')).json()).post;
  for (const actor of ['alpha', 'beta']) await publish(actor);
  const betaFirst = await share('beta', 'beta_book', 'beta_book_entry_0');
  const betaSecond = await share('beta', 'beta_book', 'beta_book_entry_1');
  assert.equal((await stats()).readCount, 4, 'Two legacy final thoughts establish one completion for exact community text');
  assert.equal((await mine('beta')).hasSharedCompletion, true);
  await share('beta', 'beta_book', 'beta_book_entry_0', 200);
  assert.equal((await stats()).readCount, 4, 'Resharing the same entry does not create a reread');
  await expect(await addRead('beta_explicit', '2026-10-04', 'beta'), 201, 'Explicit first read overlaps a shared completion');
  assert.equal((await stats()).readCount, 4);
  await expect(await call(path + '/reads/beta_explicit', 'beta', { method: 'DELETE' }), 200, 'Remove explicit completion while a shared completion remains');
  assert.equal((await stats()).readCount, 4);
  await expect(await call('/api/journal/' + betaFirst.id, 'beta', { method: 'DELETE' }), 200, 'Unshare one final thought');
  assert.equal((await stats()).readCount, 4);
  await expect(await call('/api/journal/' + betaSecond.id, 'beta', { method: 'DELETE' }), 200, 'Unshare the remaining completion');
  assert.equal((await stats()).readCount, 3); assert.equal((await mine('beta')).hasSharedCompletion, false);

  // Catalog IDs, not title similarity, group new snapshots across editions.
  const workId = 'OL45804W';
  states.alpha.books.push({ ...makeBook('catalog_alpha', 'Edition one', 'Writer one'), catalogId: workId, editionId: 'OL7353617M' });
  states.beta.books.push({ ...makeBook('catalog_beta', 'A different-language edition', 'Writer variant'), catalogId: workId, editionId: 'OL7353618M' });
  states.beta.books.push(makeBook('legacy_same_title', 'Edition one', 'Writer one'));
  for (const actor of ['alpha', 'beta']) await save(actor);
  await share('beta', 'legacy_same_title', 'legacy_same_title_entry_0');
  assert.equal((await stats(workId)).readCount, 0, 'Legacy matching never guesses an Open Library work from its title and author');
  const aPosts = [];
  for (const entry of states.alpha.books[1].readingLog) aPosts.push(await share('alpha', 'catalog_alpha', entry.id));
  const bPost = await share('beta', 'catalog_beta', 'catalog_beta_entry_0');
  assert.equal((await stats(workId)).readCount, 2); assert.equal((await stats(workId)).readerCount, 2);
  assert.equal(aPosts[0].book.catalogId, workId); assert.equal(aPosts[0].book.editionId, 'OL7353617M');
  assert.equal((await database.prepare('SELECT catalog_id FROM reading_posts WHERE id = ?').bind(bPost.id).first()).catalog_id, workId);
  await expect(await call('/api/profile', 'beta', { method: 'DELETE' }), 200, 'Unpublish profile revokes its journal-derived contribution');
  assert.equal((await stats(workId)).readCount, 1);
  await publish('beta');
  assert.equal((await stats(workId)).readCount, 1, 'Republishing a profile does not revive old shared journals');
  await expect(await call('/api/journal/' + aPosts[0].id, 'alpha', { method: 'DELETE' }), 200, 'Remove one same-work completion snapshot');
  assert.equal((await stats(workId)).readCount, 1);
  await expect(await call('/api/journal/' + aPosts[1].id, 'alpha', { method: 'DELETE' }), 200, 'Remove the last same-work completion snapshot');
  assert.equal((await stats(workId)).readCount, 0);

  // SQL limits are atomic, including concurrent requests; the response never
  // truncates contributions that the same API allowed the reader to create.
  const existingReads = (await mine('alpha')).reads;
  const filler = Array.from({ length: 200 - existingReads.length }, (_, index) => ({ id: 'filler_' + index, date: new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10) }));
  await database.prepare("INSERT INTO book_reads (owner_id,id,catalog_id,finished_at,created_at) SELECT ?,json_extract(value,'$.id'),?,json_extract(value,'$.date'),? FROM json_each(?)")
    .bind(accounts.get('alpha').id, id, stamp, JSON.stringify(filler)).run();
  assert.equal((await mine('alpha')).reads.length, 200);
  assert.equal((await addRead('too_many', '2026-10-05')).status, 409);
  await expect(await addRead('read_one', '2026-10-01'), 200, 'Retry still succeeds at the read limit');
  assert.equal((await stats()).readCount, 200);
  await database.prepare('DELETE FROM auth_user WHERE id = ?').bind(accounts.get('alpha').id).run();
  assert.deepEqual(await stats(), { averageRating: null, ratingCount: 0, readCount: 0, readerCount: 0 }, 'Deleting an account cascades its explicit community contributions');
  report('Book pages: minimal manual publication, stable identity, private data exclusion, explicit rating/read aggregates, atomic deduplication and limits, account isolation, cross-edition journal counts, removal and profile revocation');
}
