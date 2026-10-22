import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionAccountKey, disconnectConnection, syncConnection, type RemoteBook } from '../lib/connections';
import { emptyState, newBook, newShelf, type AppState, type Book, type LibraryConnection } from '../lib/types';
import { parseCatalogJSON } from '../lib/import';
import { catalogJSON } from '../lib/export';

const stamp = '2026-10-22T12:00:00.000Z';
const connection = (patch: Partial<LibraryConnection> = {}): LibraryConnection => ({
  id: 'cx_test', provider: 'hardcover', accountKey: 'a'.repeat(64), label: 'My Hardcover', autoSync: true,
  syncProgress: false, connectedAt: stamp, ...patch,
});
const remote = (patch: Partial<RemoteBook> = {}): RemoteBook => ({
  remoteId: '1', title: 'A story', author: 'A writer', coverUrl: 'https://example.org/cover.jpg',
  isbn: '9780140328721', pages: 240, url: 'https://hardcover.app/books/a-story', rating: 4,
  status: 'reading', progress: 40, ...patch,
});
const stateWith = (...books: Book[]): AppState => ({ ...emptyState(), books });

test('connection import defaults to independent bookmarks and adds a source without claiming a purchase', () => {
  const original = emptyState(), result = syncConnection(original, connection(), [remote({ owned: true })], stamp);
  assert.equal(original.books.length, 0);
  assert.deepEqual(result.summary, { added: 1, updated: 0, preserved: 0 });
  const book = result.state.books[0];
  assert.equal(book.status, 'unread'); assert.equal(book.progress, 0);
  assert.equal(book.title, 'A story'); assert.equal(book.pages, 240); assert.equal(book.rating, 4);
  assert.equal(book.sources[0].kind, 'link'); assert.equal(book.sources[0].label, 'Hardcover · marked owned');
  assert.equal(book.connections?.[0].lastImported.progress, undefined);
  assert.deepEqual(result.state.shelves, []); assert.equal(book.readingLog, undefined);
});

test('three-way metadata sync updates untouched fields and preserves local edits, files, thoughts and shelf placements', () => {
  const first = syncConnection(emptyState(), connection(), [remote()], stamp).state;
  const book = first.books[0];
  book.title = 'My title'; book.rating = null; book.coverUrl = '/api/assets/my_cover';
  book.notes = 'My private notes'; book.review = 'My private review';
  book.sources.push({ id: 'epub_source', kind: 'file', label: 'EPUB', assetId: 'my_epub' });
  book.readingLog = [{ id: 'thought', body: 'My thought', progress: 12, createdAt: stamp }];
  const shelf = newShelf(); shelf.items = [{ id: 'placed', kind: 'book', bookId: book.id, pinned: false, facing: 'spine', slot: 99, placement: { row: 0, x: .37 } }];
  first.shelves = [shelf];
  const before = structuredClone(first);
  const next = syncConnection(first, connection(), [remote({ title: 'Provider title', author: 'Corrected writer', pages: 260, coverUrl: 'https://example.org/new.jpg', rating: 5 })]).state;
  assert.deepEqual(first, before, 'The merge does not mutate the supplied state');
  assert.equal(next.books[0].title, 'My title'); assert.equal(next.books[0].rating, null); assert.equal(next.books[0].coverUrl, '/api/assets/my_cover');
  assert.equal(next.books[0].author, 'Corrected writer'); assert.equal(next.books[0].pages, 260);
  assert.equal(next.books[0].notes, book.notes); assert.equal(next.books[0].review, book.review);
  assert.deepEqual(next.books[0].readingLog, book.readingLog); assert.deepEqual(next.shelves, first.shelves);
  assert.deepEqual(next.books[0].sources.find(source => source.id === 'epub_source'), book.sources[1]);
  const later = syncConnection(next, connection(), [remote({ title: 'Another provider title', pages: 280, rating: 3 })]).state;
  assert.equal(later.books[0].title, 'My title'); assert.equal(later.books[0].rating, null); assert.equal(later.books[0].pages, 280);
});

test('initial attachment fills missing catalog fields and recognizes equivalent ISBN10 and ISBN13 editions', () => {
  const local = { ...newBook('My edition title', 'Local author'), isbn: '0140328726', rating: 2 };
  const result = syncConnection(stateWith(local), connection(), [remote()]);
  assert.equal(result.summary.added, 0); assert.equal(result.state.books.length, 1);
  assert.equal(result.state.books[0].id, local.id); assert.equal(result.state.books[0].isbn, local.isbn);
  assert.equal(result.state.books[0].title, local.title); assert.equal(result.state.books[0].author, local.author);
  assert.equal(result.state.books[0].rating, 2); assert.equal(result.state.books[0].pages, 240);
  assert.equal(result.state.books[0].coverUrl, remote().coverUrl);
});

test('different known ISBNs and ambiguous local editions are never silently combined', () => {
  const local = { ...newBook('A story', 'A writer'), isbn: '9780061120084' };
  const distinct = syncConnection(stateWith(local), connection(), [remote()]);
  assert.equal(distinct.state.books.length, 2); assert.equal(distinct.state.books[0].id, local.id);
  assert.equal(distinct.state.books[0].connections, undefined);
  const duplicate = { ...local, id: 'second_copy', isbn: '9780140328721' }, firstCopy = { ...local, isbn: duplicate.isbn };
  const ambiguous = syncConnection(stateWith(firstCopy, duplicate), connection(), [remote()]);
  assert.equal(ambiguous.state.books.length, 3, 'Two matching physical copies need a new record rather than an arbitrary attachment');
});

test('explicit progress import accepts a complete new bookmark but preserves an existing manual reading position', () => {
  const enabled = connection({ syncProgress: true });
  const imported = syncConnection(emptyState(), enabled, [remote()]).state.books[0];
  assert.equal(imported.status, 'reading'); assert.equal(imported.progress, 40);
  for (const patch of [
    { status: 'reading' as const, progress: 0 }, { status: 'reading' as const, progress: 12 },
    { status: 'paused' as const, progress: 40 }, { status: 'unread' as const, progress: 0, finishedAt: stamp },
    { status: 'unread' as const, progress: 0, readingLog: [{ id: 'earlier_read', body: '', progress: 100, createdAt: stamp }] },
  ]) {
    const local = { ...newBook('A story', 'A writer'), isbn: remote().isbn, ...patch };
    const merged = syncConnection(stateWith(local), enabled, [remote({ status: 'read', progress: 100 })]).state.books[0];
    assert.equal(merged.status, local.status); assert.equal(merged.progress, local.progress);
  }
});

test('progress and status stay atomic through local rereads and incomplete remote bookmarks', () => {
  const enabled = connection({ syncProgress: true });
  const finished = syncConnection(emptyState(), enabled, [remote({ status: 'read', progress: 100 })]).state;
  const partial = syncConnection(finished, enabled, [remote({ status: 'reading', progress: undefined })]).state.books[0];
  assert.equal(partial.status, 'read'); assert.equal(partial.progress, 100, 'An unknown provider reread must not borrow a completed local percentage');
  finished.books[0].status = 'reading'; finished.books[0].progress = 8;
  const reread = syncConnection(finished, enabled, [remote({ status: 'read', progress: 100 })]).state.books[0];
  assert.equal(reread.status, 'reading'); assert.equal(reread.progress, 8);
  const singleEdit = syncConnection(emptyState(), enabled, [remote()]).state;
  singleEdit.books[0].status = 'paused';
  const later = syncConnection(singleEdit, enabled, [remote({ status: 'read', progress: 100 })]).state.books[0];
  assert.equal(later.status, 'paused'); assert.equal(later.progress, 40, 'A status edit protects the whole local bookmark');
});

test('turning progress sync off and on resumes only when its last imported bookmark remains untouched', () => {
  const enabled = connection({ syncProgress: true }), disabled = connection({ syncProgress: false });
  const initial = syncConnection(emptyState(), enabled, [remote()]).state;
  const paused = syncConnection(initial, disabled, [remote({ progress: 60 })]).state;
  assert.equal(paused.books[0].progress, 40);
  const resumed = syncConnection(paused, enabled, [remote({ progress: 60 })]).state;
  assert.equal(resumed.books[0].progress, 60);
  paused.books[0].progress = 10;
  const manual = syncConnection(paused, enabled, [remote({ status: 'read', progress: 100 })]).state.books[0];
  assert.equal(manual.status, 'reading'); assert.equal(manual.progress, 10);
});

test('retries are idempotent and an absent remote book never deletes a local record or source', () => {
  const first = syncConnection(emptyState(), connection(), [remote(), remote()], stamp).state;
  const repeated = syncConnection(first, connection(), [remote()], stamp);
  assert.deepEqual(repeated.state.books, first.books); assert.deepEqual(repeated.state.shelves, first.shelves);
  assert.deepEqual(repeated.state.connections, first.connections?.map(item => ({ ...item, lastSummary: { added: 0, updated: 0, preserved: 0 } })));
  assert.deepEqual(repeated.summary, { added: 0, updated: 0, preserved: 0 });
  const absent = syncConnection(first, connection(), []);
  assert.deepEqual(absent.state.books, first.books); assert.deepEqual(absent.state.shelves, first.shelves);
  assert.equal(absent.state.connections?.length, 1);
});

test('book, source, linked-record and connection limits reject the entire merge without mutation', () => {
  const full = stateWith(...Array.from({ length: 2000 }, (_, index) => ({ ...newBook('Local ' + index), id: 'book_' + index })));
  const cases: { state: AppState; incoming: RemoteBook[]; expected: RegExp }[] = [
    { state: full, incoming: [remote({ title: 'Local 0', author: 'Unknown author', isbn: undefined }), remote({ remoteId: '2' })], expected: /2,000 books/ },
    { state: stateWith({ ...newBook('A story', 'A writer'), sources: Array.from({ length: 30 }, (_, i) => ({ id: 's_' + i, kind: 'link' as const, label: 'Source ' + i })) }), incoming: [remote()], expected: /30 sources/ },
    { state: { ...stateWith({ ...newBook('A story', 'A writer'), connections: Array.from({ length: 20 }, (_, i) => ({ connectionId: 'cx_test', remoteId: 'old_' + i, sourceId: 's_' + i, lastImported: {} })) }), connections: [connection()] }, incoming: [remote()], expected: /20 account records/ },
    { state: { ...emptyState(), connections: Array.from({ length: 10 }, (_, i) => connection({ id: 'connection_' + i, accountKey: String(i).repeat(64) })) }, incoming: [remote()], expected: /10 accounts/ },
  ];
  for (const item of cases) {
    const before = structuredClone(item.state);
    assert.throws(() => syncConnection(item.state, connection(), item.incoming), item.expected);
    assert.deepEqual(item.state, before);
  }
  assert.throws(() => syncConnection(emptyState(), connection(), Array.from({ length: 2001 }, () => remote())), /2,000 books/);
});

test('disconnect keeps imported catalog data, files, bookmarks, journals and placements', () => {
  const connected = syncConnection(emptyState(), connection({ syncProgress: true }), [remote()]).state;
  connected.books[0].readingLog = [{ id: 'thought', body: 'A thought', progress: 40, createdAt: stamp }];
  const shelf = newShelf(); shelf.items.push({ id: 'placed', kind: 'book', bookId: connected.books[0].id, slot: 0, pinned: false, facing: 'cover' });
  connected.shelves = [shelf];
  const next = disconnectConnection(connected, 'cx_test');
  assert.deepEqual(next.connections, []); assert.equal(next.books[0].connections, undefined);
  const { connections: _prior, ...data } = connected.books[0];
  const { connections: _next, ...remaining } = next.books[0];
  assert.deepEqual(remaining, data); assert.deepEqual(next.shelves, connected.shelves);
  assert.equal(connected.connections?.length, 1); assert.equal(connected.books[0].connections?.length, 1);
});

test('persisted connector records and baselines contain only allowed metadata, never provider credentials or private account payloads', () => {
  const privateConnection = { ...connection(), accessToken: 'PRIVATE_ACCESS_TOKEN', refreshToken: 'PRIVATE_REFRESH_TOKEN', email: 'PRIVATE_ACCOUNT_EMAIL' } as LibraryConnection;
  const privateRemote = { ...remote(), notes: 'PRIVATE_REMOTE_NOTES', review: 'PRIVATE_REMOTE_REVIEW', account: { email: 'PRIVATE_ACCOUNT_EMAIL' }, token: 'PRIVATE_ACCESS_TOKEN' } as RemoteBook;
  const first = syncConnection(emptyState(), privateConnection, [privateRemote]).state;
  Object.assign(first.books[0].connections![0].lastImported, { accessToken: 'PRIVATE_BASELINE_TOKEN' });
  const result = syncConnection(first, privateConnection, [privateRemote]).state;
  for (const secret of ['PRIVATE_ACCESS_TOKEN', 'PRIVATE_REFRESH_TOKEN', 'PRIVATE_ACCOUNT_EMAIL', 'PRIVATE_REMOTE_NOTES', 'PRIVATE_REMOTE_REVIEW', 'PRIVATE_BASELINE_TOKEN']) assert.equal(JSON.stringify(result).includes(secret), false, secret);
  assert.equal(result.books[0].notes, ''); assert.equal(result.books[0].review, '');
});

test('connection identity cannot be rebound and account fingerprints are scoped to the Cybershelf account', async () => {
  const state = syncConnection(emptyState(), connection(), [remote()]).state;
  const before = structuredClone(state);
  assert.throws(() => syncConnection(state, connection({ accountKey: 'b'.repeat(64) }), [remote()]), /different provider account/);
  assert.throws(() => syncConnection(state, connection({ id: 'duplicate_connection' }), [remote()]), /already connected/);
  assert.deepEqual(state, before);
  const same = await connectionAccountKey('cybershelf_a', 'provider_1');
  assert.match(same, /^[a-f0-9]{64}$/);
  assert.equal(same, await connectionAccountKey('cybershelf_a', 'provider_1'));
  assert.notEqual(same, await connectionAccountKey('cybershelf_b', 'provider_1'));
  assert.notEqual(same, await connectionAccountKey('cybershelf_a', 'provider_2'));
});

test('catalog backup restores connection provenance and preferences while stripping credential-shaped extras', () => {
  const connected = syncConnection(emptyState(), connection({ syncProgress: true }), [remote()], stamp).state;
  assert.deepEqual(parseCatalogJSON(catalogJSON(connected)), connected);
  const untrusted = JSON.parse(catalogJSON(connected));
  untrusted.connections[0].accessToken = 'PRIVATE_BACKUP_TOKEN';
  untrusted.books[0].connections[0].lastImported.refreshToken = 'PRIVATE_BACKUP_REFRESH';
  const restored = parseCatalogJSON(JSON.stringify(untrusted));
  assert.deepEqual(restored, connected);
  assert.equal(JSON.stringify(restored).includes('PRIVATE_BACKUP_'), false);
  untrusted.books[0].connections[0].connectionId = 'missing';
  assert.throws(() => parseCatalogJSON(JSON.stringify(untrusted)), /missing account connection/);
});
