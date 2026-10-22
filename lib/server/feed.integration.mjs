import assert from 'node:assert/strict';

/** Exercises the real session and D1 routes in the disposable Worker. */
export async function runFeedIntegration({ call, save, expectStatus, ownerId, otherId, report, onVersion = () => {} }) {
  const initial = await (await expectStatus(await call('/api/state', 'owner'), 200, 'Load current library for feed checks')).json();
  const original = structuredClone(initial.state), state = structuredClone(initial.state);
  let version = initial.version;
  let profileId = (await (await call('/api/profile', 'owner')).json()).profile.id;
  const initialProfileId = profileId, activityIds = new Set();
  const persist = async () => {
    version = (await (await expectStatus(await save(state, version), 200, 'Save feed fixtures')).json()).version;
    onVersion(version);
  };
  const jsonPost = (path, body, account = 'owner', headers = {}) => call(path, account, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const feed = async (account = 'other', cursor) => (await expectStatus(await call('/api/feed' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), account), 200, 'Read following feed')).json();
  const follow = (id = profileId, account = 'other', headers = {}) => jsonPost('/api/follows', { profileId: id }, account, headers);
  const shareReading = () => jsonPost('/api/journal', { bookId: 'book1', entryId: 'feed_shared_entry' });
  const publishProfile = async () => {
    const payload = { shelfId: state.profile.featuredShelfId, name: state.profile.name, bio: state.profile.bio, shelfUpdatedAt: state.shelves.find(shelf => shelf.id === state.profile.featuredShelfId).updatedAt };
    profileId = (await (await expectStatus(await jsonPost('/api/profile', payload), 201, 'Republish feed actor profile')).json()).profile.id;
  };
  const announce = async (kind) => {
    const response = await expectStatus(await jsonPost('/api/activity', { kind, bookId: 'book1', price: 'PRIVATE_PRICE', body: 'IGNORED_ANNOUNCEMENT_BODY', book: { title: 'INJECTED_TITLE' } }), 201, 'Explicitly share a book announcement');
    const item = (await response.json()).item; activityIds.add(item.id); return item;
  };
  const eventKey = item => (item.kind === 'purchased' || item.kind === 'added' ? 'activity' : item.kind === 'shelf_updated' ? 'shelf' : item.kind) + ':' + item.id;

  for (const path of ['/api/feed', '/api/follows', '/api/activity']) assert.equal((await call(path, null)).status, 401, path + ' requires a verified reader');
  assert.equal((await call('/api/feed', 'other', { headers: { 'X-Cybershelf-Account': ownerId } })).status, 409);
  assert.equal((await follow(profileId, null)).status, 401);
  assert.equal((await follow(profileId, 'other', { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await follow(profileId, 'other', { 'X-Cybershelf-Account': ownerId })).status, 409);
  assert.equal((await follow(profileId, 'owner')).status, 400, 'Readers cannot follow themselves');
  assert.equal((await follow('missing_public_reader')).status, 404);
  assert.equal((await jsonPost('/api/activity', { kind: 'added', bookId: 'book1' }, 'other')).status, 409, 'Announcements need a public profile');
  for (const [path, method] of [['/api/follows', 'POST'], ['/api/follows/' + profileId, 'DELETE'], ['/api/activity', 'POST'], ['/api/activity/missing', 'DELETE']]) {
    assert.equal((await call(path, 'other', { method, headers: { 'X-Cybershelf-Account': ownerId } })).status, 409, 'Account-switch precondition precedes parsing: ' + path);
  }
  await expectStatus(await follow(), 200, 'Follow without publishing a profile');
  await expectStatus(await follow(), 200, 'Following twice is idempotent');
  const people = await (await call('/api/follows', 'other')).json();
  assert.equal(people.accountId, otherId); assert.equal(people.ownProfileId, undefined);
  assert.deepEqual(people.following.map(person => person.id), [profileId]);
  assert.equal(JSON.stringify(people.following).includes(ownerId), false, 'Following lists use public identities');
  assert.equal((await feed('owner')).items.length, 0, 'A reader does not receive their own activity');
  assert.equal((await feed('owner')).followingCount, 0);
  const baseline = await feed();
  assert.equal(baseline.followingCount, 1);
  assert.ok(baseline.items.every(item => item.kind === 'shelf' || item.kind === 'shelf_updated'), 'Only deliberately published shelves exist before sharing any entries');

  const book = state.books.find(item => item.id === 'book1');
  book.readingLog = [...(book.readingLog ?? []),
    { id: 'feed_shared_entry', body: 'FEED_SHARED_READING_THOUGHT', progress: 45, createdAt: '2026-02-01T00:00:00.000Z' },
    { id: 'feed_private_entry', body: 'FEED_PRIVATE_READING_THOUGHT', progress: 100, createdAt: '2026-02-02T00:00:00.000Z' },
  ];
  state.books.push({ ...structuredClone(book), id: 'feed_private_book', title: 'FEED_PRIVATE_LIBRARY_BOOK', coverUrl: '', spineUrl: '', sources: [], readingLog: [] });
  state.shelves.push({ ...structuredClone(state.shelves[0]), id: 'feed_private_shelf', title: 'FEED_PRIVATE_SHELF', items: [] });
  await persist();
  const unshared = await feed();
  assert.deepEqual(unshared.items.map(eventKey), baseline.items.map(eventKey), 'Library saves, logs, and shelf creation remain private until shared');
  assert.equal((await jsonPost('/api/activity', { kind: 'automatic_purchase', bookId: 'book1' })).status, 400);
  assert.equal((await jsonPost('/api/activity', { kind: 'purchased', bookId: 'missing_book' })).status, 404);
  assert.equal((await jsonPost('/api/activity', { kind: 'purchased', bookId: 'book1' }, 'owner', { Origin: 'https://attacker.invalid' })).status, 403);
  const reading = (await (await expectStatus(await shareReading(), 201, 'Share a reading entry into the feed')).json()).post;
  const purchase = await announce('purchased'), addition = await announce('added');
  assert.equal(purchase.actor.id, profileId); assert.equal(purchase.book.coverUrl, '', 'Acquisition updates do not publish a private upload URL');
  for (const key of ['sources', 'notes', 'review', 'readingLog', 'rating', 'progress']) assert.equal(key in purchase.book, false, 'Announcement redaction: ' + key);
  for (const secret of ['PRIVATE_PRICE', 'IGNORED_ANNOUNCEMENT_BODY', 'INJECTED_TITLE', 'secret-note', 'secret-review']) assert.equal(JSON.stringify(purchase).includes(secret), false);
  const comment = (await (await expectStatus(await jsonPost('/api/journal/' + reading.id + '/comments', { body: 'FEED_SHARED_REPLY_AT_65', progress: 65 }), 201, 'Share an author reply into the feed')).json()).comment;
  let current = await feed();
  assert.equal(current.items.find(item => item.id === reading.id).progress, 45);
  assert.equal(current.items.find(item => item.id === comment.id).progress, 65);
  assert.equal(current.items.find(item => item.id === comment.id).postId, reading.id);
  assert.equal(current.items.find(item => item.id === comment.id).commentId, comment.id);
  assert.ok(current.items.some(item => item.id === purchase.id && item.kind === 'purchased'));
  assert.ok(current.items.some(item => item.id === addition.id && item.kind === 'added'));
  for (const secret of [ownerId, otherId, 'FEED_PRIVATE_READING_THOUGHT', 'FEED_PRIVATE_LIBRARY_BOOK', 'FEED_PRIVATE_SHELF', 'secret-note', 'secret-review', 'Private PDF']) assert.equal(JSON.stringify(current).includes(secret), false, 'Feed contains no private value: ' + secret);
  assert.ok(current.items.every(item => item.actor.id === profileId));
  assert.equal((await feed('owner')).items.length, 0, 'Sharing does not subscribe the author to their own events');

  book.readingLog.find(entry => entry.id === 'feed_shared_entry').progress = 90;
  await persist();
  await expectStatus(await shareReading(), 200, 'Update the shared parent progress');
  current = await feed();
  assert.equal(current.items.find(item => item.id === comment.id).progress, 90, 'A reply inherits the higher spoiler boundary when its parent entry advances');
  assert.equal(current.items.filter(item => item.id === reading.id).length, 1, 'Updating an entry replaces its one feed event');

  // Every older announcement must remain reachable for removal. These explicit
  // shares plus ten public shelves also cross the real 30-item feed boundary.
  for (let index = 0; index < 19; index++) await announce('added');
  const ownFirst = await (await expectStatus(await call('/api/activity', 'owner'), 200, 'Read the first page of owned updates')).json();
  assert.equal(ownFirst.items.length, 20); assert.ok(ownFirst.nextCursor);
  const ownSecond = await (await expectStatus(await call('/api/activity?cursor=' + encodeURIComponent(ownFirst.nextCursor), 'owner'), 200, 'Read older owned updates')).json();
  assert.equal(ownSecond.items.length, 1); assert.equal(ownSecond.nextCursor, undefined);
  assert.deepEqual(new Set([...ownFirst.items, ...ownSecond.items].map(item => item.id)), activityIds, 'All owned announcements are reachable for removal');
  assert.equal((await call('/api/activity?cursor=not-a-cursor', 'owner')).status, 400);
  current = await feed();
  const beforePagination = current.items.map(eventKey), fixtureShelves = Array.from({ length: 10 }, (_, index) => ({
    ...structuredClone(state.shelves[0]), id: 'feed_page_' + index, title: 'Feed pagination ' + index, description: '', items: [], updatedAt: new Date().toISOString(),
  }));
  state.shelves.push(...fixtureShelves); await persist();
  const publicationIds = [];
  for (let start = 0; start < fixtureShelves.length; start += 5) {
    const responses = await Promise.all(fixtureShelves.slice(start, start + 5).map(shelf => jsonPost('/api/publications', { shelfId: shelf.id })));
    for (const response of responses) publicationIds.push((await (await expectStatus(response, 201, 'Publish cursor fixture shelf')).json()).id);
  }
  fixtureShelves[0].title = 'A deliberately updated public shelf'; fixtureShelves[0].updatedAt = new Date().toISOString(); await persist();
  await expectStatus(await jsonPost('/api/publications', { shelfId: fixtureShelves[0].id }), 200, 'Update a published shelf');
  const first = await feed();
  assert.equal(first.items.length, 30); assert.ok(first.nextCursor, 'A next page is supplied only when another item exists');
  const second = await feed('other', first.nextCursor), all = [...first.items, ...second.items];
  assert.equal(second.nextCursor, undefined);
  assert.equal(new Set(all.map(eventKey)).size, all.length, 'Cursor pages never duplicate an event');
  assert.deepEqual(new Set(all.map(eventKey)), new Set([...beforePagination, ...publicationIds.map(id => 'shelf:' + id)]), 'Cursor pagination retains every public event');
  for (let index = 1; index < all.length; index++) {
    const previous = all[index - 1], next = all[index];
    assert.ok(previous.createdAt > next.createdAt || previous.createdAt === next.createdAt && eventKey(previous) > eventKey(next), 'Events have a stable timestamp and ID order');
  }
  const updatedShelf = all.find(item => item.id === publicationIds[0]);
  assert.equal(updatedShelf.kind, 'shelf_updated'); assert.equal(updatedShelf.shelf.shelf.title, fixtureShelves[0].title);
  assert.equal(updatedShelf.shelf.profileId, profileId);
  assert.equal((await call('/api/feed?cursor=not-a-cursor', 'other')).status, 400);
  assert.equal((await call('/api/feed?cursor=' + encodeURIComponent(btoa(JSON.stringify(['2026-01-01T00:00:00.000Z', 'private:forged']))), 'other')).status, 400);
  assert.equal((await call('/api/activity/' + purchase.id, 'other', { method: 'DELETE' })).status, 404, 'Following never grants the ability to remove another reader’s update');
  await expectStatus(await call('/api/activity/' + purchase.id, 'owner', { method: 'DELETE' }), 200, 'Delete an owned acquisition update'); activityIds.delete(purchase.id);
  const afterDeletion = [...(await feed()).items, ...(await feed('other', first.nextCursor)).items];
  assert.equal(afterDeletion.some(item => item.id === purchase.id), false);

  await expectStatus(await call('/api/profile', 'owner', { method: 'DELETE' }), 200, 'Unpublish the followed identity');
  const hidden = await feed(); assert.equal(hidden.items.length, 0); assert.equal(hidden.followingCount, 1);
  const unavailable = (await (await call('/api/follows', 'other')).json()).following;
  assert.deepEqual(unavailable, [{ id: initialProfileId, name: 'Unavailable profile', bio: '', unavailable: true }], 'Hidden identities retain only a removal handle');
  assert.equal((await follow(initialProfileId)).status, 404, 'A hidden public identifier cannot be newly followed');
  await publishProfile(); assert.notEqual(profileId, initialProfileId);
  const republished = await feed();
  assert.equal(republished.followingCount, 1, 'The relationship follows the same owner across a new public identity');
  assert.ok(republished.items.length > 0 && republished.items.every(item => item.kind === 'shelf' || item.kind === 'shelf_updated'), 'Republishing does not revive captured reading, comment, or acquisition snapshots');
  assert.ok(republished.items.every(item => item.actor.id === profileId));
  assert.equal((await (await call('/api/follows', 'other')).json()).following[0].id, profileId);
  await expectStatus(await shareReading(), 200, 'Explicitly reshare a reading entry with the new identity');
  const reshared = await feed();
  assert.ok(reshared.items.some(item => item.id === reading.id));
  assert.equal(reshared.items.some(item => item.id === comment.id || item.id === addition.id), false, 'An old comment or acquisition remains hidden after a parent is reshared');
  const newAnnouncement = await announce('purchased');
  assert.ok((await feed()).items.some(item => item.id === newAnnouncement.id));
  await expectStatus(await call('/api/follows/' + profileId, 'other', { method: 'DELETE' }), 200, 'Unfollow using the reader’s current public identity');
  assert.deepEqual(await feed(), { items: [], followingCount: 0 });
  await expectStatus(await follow(), 200, 'Follow the new public identity');
  const secondProfileId = profileId;
  await expectStatus(await call('/api/profile', 'owner', { method: 'DELETE' }), 200, 'Hide a followed profile before removing the relationship');
  assert.equal((await (await call('/api/follows', 'other')).json()).following[0].id, secondProfileId);
  await expectStatus(await call('/api/follows/' + secondProfileId, 'other', { method: 'DELETE' }), 200, 'Unfollow an unavailable identity');
  await publishProfile();
  assert.deepEqual(await feed(), { items: [], followingCount: 0 }, 'Republishing cannot restore a removed follow');

  for (const id of activityIds) await expectStatus(await call('/api/activity/' + id, 'owner', { method: 'DELETE' }), 200, 'Remove explicit test announcements');
  version = (await (await expectStatus(await save(original, version), 200, 'Restore the owner library after feed fixtures')).json()).version; onVersion(version);
  assert.equal((await call('/api/profiles/' + profileId, null)).status, 200, 'The featured profile remains public for subsequent checks');
  assert.equal((await (await call('/api/activity', 'owner')).json()).items.length, 0);
  report('Following feed: verified identities, explicit sharing, private-state redaction, effective spoiler boundaries, stable pagination, shelf changes, unfollowing and profile revocation');
  return { version, profileId };
}
