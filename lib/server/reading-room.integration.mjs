import assert from 'node:assert/strict';

/** Exercise the real built Worker, authenticated sessions, SQL filtering and
 * migration backfill. All identities and data live only in the local fixture. */
export async function runReadingRoomIntegration({ base, fetch: requestFetch, database, report = () => {} }) {
  const origin = new URL(base).origin, suffix = crypto.randomUUID(), accounts = new Map();
  const expect = async (response, status, message) => {
    assert.equal(response.status, status, `${message}: ${response.status === status ? '' : await response.clone().text()}`);
    return response;
  };
  const call = (path, actor = 'reader', init = {}) => {
    const identity = actor ? accounts.get(actor) : undefined;
    return requestFetch(new URL(path, base).href, { ...init, headers: {
      ...(identity ? { Cookie: identity.cookie, 'X-Cybershelf-Account': identity.id } : {}),
      ...((init.method ?? 'GET') === 'GET' ? {} : { Origin: origin }), ...(init.headers ?? {}),
    } });
  };
  const post = (path, body, actor = 'reader', headers = {}) => call(path, actor, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  for (const actor of ['author', 'reader']) {
    const response = await expect(await post('/api/auth/sign-up/email', {
      name: 'Room ' + actor, email: `room-${actor}-${suffix}@example.invalid`, password: 'An ephemeral room test passphrase 2026',
    }, null, { 'cf-connecting-ip': '192.0.2.43' }), 200, 'Create room fixture account');
    const data = await response.json();
    accounts.set(actor, { id: data.user.id, cookie: response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; '), version: 0 });
  }
  const book = (id, title, author, progress) => ({ id, title, author, color: '#879479', coverUrl: '', status: 'reading', progress, pages: 200, rating: null, review: 'ROOM_PRIVATE_REVIEW', notes: 'ROOM_PRIVATE_NOTES', sources: [], addedAt: '2026-10-01T00:00:00.000Z' });
  const shelf = { id: 'room_shelf', title: 'Reading together', description: '', bookcase: 'open', layout: 'balanced', finish: 'paper', items: [], updatedAt: '2026-10-01T00:00:00.000Z' };
  const marks = [0, 10, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100];
  const authorBook = { ...book('author_book', 'Café  Moon', 'A. Reader', 100), readingLog: [
    ...marks.map((progress, index) => ({ id: 'room_entry_' + index, body: 'ROOM_THOUGHT_' + progress, progress, page: progress * 2, createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() })),
    { id: 'room_private', body: 'ROOM_NEVER_SHARED', progress: 25, createdAt: '2026-10-01T01:00:00.000Z' },
  ] };
  const wrongAuthor = { ...book('wrong_author', 'Café  Moon', 'Different Author', 100), readingLog: [{ id: 'wrong_author_entry', body: 'ROOM_WRONG_AUTHOR', progress: 0, createdAt: '2026-10-01T01:00:00.000Z' }] };
  const readerBook = { ...book('reader_book', 'ＣＡＦÉ\tmoon', ' a. reader ', 25), readingLog: [15, 55, 100].map(progress => ({ id: 'room_self_' + progress, body: 'ROOM_SELF_' + progress, progress, createdAt: new Date(Date.UTC(2026, 9, 2, 0, progress)).toISOString() })) };
  const states = {
    author: { schemaVersion: 1, profile: { name: 'Room author', bio: '', featuredShelfId: shelf.id }, books: [authorBook, wrongAuthor], shelves: [structuredClone(shelf)] },
    reader: { schemaVersion: 1, profile: { name: 'Room reader', bio: '', featuredShelfId: shelf.id }, books: [readerBook, { ...book('finished_copy', 'Café Moon', 'A. Reader', 100), status: 'read' }], shelves: [structuredClone(shelf)] },
  };
  const save = async actor => {
    const identity = accounts.get(actor);
    const response = await expect(await call('/api/state', actor, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: states[actor], version: identity.version }) }), 200, 'Save room fixture');
    identity.version = (await response.json()).version;
  };
  const publishProfile = async actor => {
    const state = states[actor];
    return (await (await expect(await post('/api/profile', { shelfId: shelf.id, shelfUpdatedAt: shelf.updatedAt, name: state.profile.name, bio: state.profile.bio }, actor), 201, 'Publish room profile')).json()).profile.id;
  };
  for (const actor of ['author', 'reader']) { await save(actor); accounts.get(actor).profileId = await publishProfile(actor); }
  const share = async (actor, bookId, entryId, status = 201) => (await (await expect(await post('/api/journal', { bookId, entryId }, actor), status, 'Share room entry')).json()).post;
  const authorPosts = [];
  for (const entry of authorBook.readingLog.filter(entry => entry.id !== 'room_private')) authorPosts.push(await share('author', authorBook.id, entry.id));
  await share('author', wrongAuthor.id, 'wrong_author_entry');
  const ownPosts = [];
  for (const entry of readerBook.readingLog) ownPosts.push(await share('reader', readerBook.id, entry.id));
  // A real pre-v0.4 snapshot has an empty key until the first room request.
  await database.prepare("UPDATE reading_posts SET book_key = '' WHERE id = ?").bind(authorPosts[2].id).run();
  const query = (extra = '') => '/api/reading-room?bookId=reader_book' + extra;
  const room = async extra => (await (await expect(await call(query(extra)), 200, 'Read the room at saved progress')).json());
  assert.equal((await call(query(), null)).status, 401);
  assert.equal((await call(query(), 'reader', { headers: { 'X-Cybershelf-Account': accounts.get('author').id } })).status, 409);
  assert.equal((await call('/api/reading-room?bookId=author_book')).status, 404, 'A private book ID from another account is not accepted');
  assert.equal((await call(query('&order=unknown'))).status, 400);
  let current = await room();
  assert.deepEqual(current.items.map(item => item.id), [ownPosts[0].id], 'A room includes the reader’s own deliberately shared thoughts');
  await expect(await post('/api/follows', { profileId: accounts.get('author').profileId }), 200, 'Follow the room author');
  current = await room('&progress=100');
  assert.deepEqual(current.reader, { progress: 25, page: 50 }, 'Client query progress and a finished second copy cannot raise this bookmark');
  assert.equal(current.followingCount, 1); assert.equal(current.totalVisible, 5); assert.equal(current.waitingCount, 16);
  assert.deepEqual(current.items.map(item => item.entry.progress), [0, 10, 15, 20, 25]);
  for (const secret of ['ROOM_NEVER_SHARED', 'ROOM_WRONG_AUTHOR', 'ROOM_THOUGHT_100', 'ROOM_PRIVATE_NOTES', 'ROOM_PRIVATE_REVIEW', accounts.get('author').id]) assert.equal(JSON.stringify(current).includes(secret), false, 'Room redaction: ' + secret);
  assert.notEqual((await database.prepare('SELECT book_key FROM reading_posts WHERE id = ?').bind(authorPosts[2].id).first()).book_key, '', 'Legacy Unicode metadata was indexed before the first response');
  const target = authorPosts[2], commentsPath = '/api/reading-room/' + target.id + '/comments?bookId=reader_book';
  await expect(await post('/api/journal/' + target.id + '/comments', { body: 'ROOM_LATE_REPLY', progress: 80 }, 'author'), 201, 'Create a later public reply');
  const safeReply = (await (await expect(await post(commentsPath, { body: 'ROOM_SAFE_REPLY', progress: 20 }), 201, 'Reply safely inside the room')).json()).comment;
  assert.equal((await post(commentsPath, { body: 'ROOM_REPLY_TOO_EARLY', progress: 10 })).status, 400);
  assert.equal((await post(commentsPath, { body: 'ROOM_REPLY_TOO_LATE', progress: 30 })).status, 400);
  assert.equal((await post(commentsPath, { body: 'Wrong account', progress: 20 }, 'reader', { 'X-Cybershelf-Account': accounts.get('author').id })).status, 409);
  assert.equal((await post(commentsPath, { body: 'Cross origin', progress: 20 }, 'reader', { Origin: 'https://attacker.invalid' })).status, 403);
  const replies = await (await expect(await call(commentsPath), 200, 'Read only safe replies')).json();
  assert.deepEqual(replies.comments.map(comment => comment.id), [safeReply.id]); assert.equal(replies.waitingCount, 1);
  assert.equal(JSON.stringify(replies).includes('ROOM_LATE_REPLY'), false, 'Later reply text is absent from the network payload');
  assert.equal((await room()).items.find(item => item.id === target.id).commentCount, 1, 'Visible comment counts exclude later replies');
  assert.equal((await call('/api/reading-room/' + authorPosts[17].id + '/comments?bookId=reader_book')).status, 404, 'Knowing a future post ID does not unlock its conversation');
  readerBook.progress = 100; readerBook.status = 'read'; await save('reader');
  const first = await room(), second = await room('&cursor=' + encodeURIComponent(first.nextCursor));
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 1); assert.equal(second.nextCursor, undefined);
  assert.equal(first.waitingCount, 0);
  const combined = [...first.items, ...second.items];
  assert.equal(new Set(combined.map(item => item.id)).size, 21);
  assert.deepEqual(new Set(combined.map(item => item.id)), new Set([...authorPosts, ...ownPosts].map(item => item.id)));
  for (let i = 1; i < combined.length; i++) assert.ok(combined[i - 1].entry.progress <= combined[i].entry.progress, 'Reading order is stable across pages');
  const newest = await room('&order=newest'), older = await room('&order=newest&cursor=' + encodeURIComponent(newest.nextCursor));
  assert.deepEqual(new Set([...newest.items, ...older.items].map(item => item.id)), new Set(combined.map(item => item.id)), 'Both sort orders retain every post');
  assert.equal((await call(query('&cursor=invalid'))).status, 400);
  assert.equal((await (await call(commentsPath)).json()).comments.length, 2, 'Progress unlocks later replies');
  readerBook.progress = 10; readerBook.status = 'reading'; await save('reader');
  assert.equal((await call(query('&cursor=' + encodeURIComponent(first.nextCursor)))).status, 400, 'A cursor cannot carry a prior higher ceiling into a reread');
  assert.equal((await call(commentsPath)).status, 404);
  assert.equal((await post(commentsPath, { body: 'Cannot reply to hidden parent', progress: 20 })).status, 404);
  assert.equal((await room()).totalVisible, 2, 'Moving a bookmark backwards restores spoiler protection');
  readerBook.progress = 25; await save('reader');
  authorBook.readingLog[2].progress = 70; await save('author');
  await share('author', authorBook.id, authorBook.readingLog[2].id, 200);
  assert.equal((await call(commentsPath)).status, 404, 'Resharing a parent later also hides its earlier replies');
  assert.equal((await room()).items.some(item => item.id === target.id), false);
  await expect(await call('/api/follows/' + accounts.get('author').profileId, 'reader', { method: 'DELETE' }), 200, 'Unfollow room author');
  assert.deepEqual((await room()).items.map(item => item.id), [ownPosts[0].id]);
  assert.equal((await call('/api/reading-room/' + authorPosts[0].id + '/comments?bookId=reader_book')).status, 404, 'An unfollowed conversation is not accessible through the room');
  await expect(await post('/api/follows', { profileId: accounts.get('author').profileId }), 200, 'Refollow room author');
  await expect(await call('/api/profile', 'author', { method: 'DELETE' }), 200, 'Make room author private');
  assert.deepEqual((await room()).items.map(item => item.id), [ownPosts[0].id], 'Profile revocation immediately removes shared thoughts');
  await publishProfile('author');
  assert.deepEqual((await room()).items.map(item => item.id), [ownPosts[0].id], 'Republishing a profile never revives old shared thoughts');
  await expect(await call('/api/profile', 'reader', { method: 'DELETE' }), 200, 'Hide the reader’s own shared profile');
  assert.equal((await room()).totalVisible, 0);
  report('Reading rooms: Unicode legacy matching, selected-copy bookmark ceilings, server-side post/reply spoiler filtering, safe replies, progress changes, two pagination orders, self/follow membership and immediate profile revocation');
}
