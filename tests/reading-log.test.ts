import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendReadingEntry, makeReadingEntry, readingMarker, READING_LOG_LIMIT } from '../lib/reading-log';
import { newBook } from '../lib/types';
import type { AppState } from '../lib/types';

const identity = { id: 'log_first', createdAt: '2026-10-22T10:00:00.000Z' };
const emptyState = (): AppState => ({ schemaVersion: 1, profile: { name: 'Reader', bio: '' }, books: [newBook('A story', 'A writer')], shelves: [] });

test('page and percentage markers capture progress independently of future book changes', () => {
  const book = { pages: 320, progress: 20 };
  const entry = makeReadingEntry(book, { mode: 'page', marker: '100', body: '  A thought, at this moment.  ' }, identity);
  assert.deepEqual(entry, { ...identity, page: 100, progress: 31.25, body: 'A thought, at this moment.' });
  book.progress = 92;
  assert.equal(entry.progress, 31.25);
  assert.equal(readingMarker(entry), 'Page 100 · 31.3%');
  assert.equal(makeReadingEntry(book, { mode: 'percent', marker: '42.25', body: '' }, identity).progress, 42.25);
});

test('unknown page counts ask for total pages once and never require a guessed percentage', () => {
  const entry = makeReadingEntry({ progress: 10 }, { mode: 'page', marker: '53', totalPages: '320', body: '' }, identity);
  assert.deepEqual(entry, { ...identity, page: 53, progress: 53 / 320 * 100, body: '' });
  assert.throws(() => makeReadingEntry({ pages: 0, progress: 18 }, { mode: 'page', marker: '29', body: '' }, identity), /total pages once/);
  assert.throws(() => makeReadingEntry({ progress: 100 }, { mode: 'page', marker: '29', body: '' }, identity), /total pages once/);
  assert.equal(readingMarker({ progress: 25 }), '25% read');
  for (const totalPages of ['0', '-1', '100001', '20.5', 'not a page count']) assert.throws(() => makeReadingEntry({ progress: 20 }, { mode: 'page', marker: '40', totalPages, body: '' }, identity), /Total pages/);
});

test('page-based updates retain precise bookmarks and do not round the penultimate page to finished', () => {
  const state = emptyState();
  const book = state.books[0];
  const entry = makeReadingEntry(book, { mode: 'page', marker: '99999', totalPages: '100000', body: '' }, identity);
  const next = appendReadingEntry(state, book.id, entry, 100000);
  assert.ok(entry.progress < 100);
  assert.equal(next.books[0].pages, 100000);
  assert.equal(next.books[0].currentPage, 99999);
  assert.equal(next.books[0].status, 'reading');
  assert.equal(next.books[0].finishedAt, undefined);
  assert.equal(readingMarker(entry), 'Page 99,999 · 99.9%');
});

test('a thought at an unchanged legacy bookmark cannot advance its spoiler ceiling', () => {
  const state = emptyState();
  const book = state.books[0]; book.pages = 300; book.progress = 40.3; book.status = 'reading';
  const entry = makeReadingEntry(book, { mode: 'page', marker: '120', body: 'A thought at my saved place' }, identity, true);
  const next = appendReadingEntry(state, book.id, entry, 300);
  assert.equal(entry.progress, 40.3);
  assert.equal(next.books[0].progress, 40.3);
  assert.equal(next.books[0].currentPage, undefined, 'An inferred page is not stored as an exact bookmark');
});

test('reading markers and thought length reject invalid input before saving', () => {
  for (const marker of ['', '-1', '101', 'NaN', 'Infinity']) assert.throws(() => makeReadingEntry({ progress: 0 }, { mode: 'percent', marker, body: '' }, identity));
  for (const marker of ['2.5', '-1', '301']) assert.throws(() => makeReadingEntry({ progress: 0, pages: 300 }, { mode: 'page', marker, body: '' }, identity), /Choose a page/);
  assert.throws(() => makeReadingEntry({ progress: 0 }, { mode: 'page', marker: '100001', body: '' }, identity), /Choose a page/);
  assert.throws(() => makeReadingEntry({ progress: 0 }, { mode: 'percent', marker: '50', body: 'x'.repeat(4001) }, identity), /4,000/);
});

test('saving a reading entry updates book progress without copying private review or changing old entries', () => {
  const state = emptyState();
  state.books[0].notes = 'Private notes'; state.books[0].review = 'Private review';
  const first = makeReadingEntry(state.books[0], { mode: 'percent', marker: '25', body: 'One observation' }, identity);
  const next = appendReadingEntry(state, state.books[0].id, first);
  assert.equal(state.books[0].readingLog, undefined);
  assert.equal(state.books[0].progress, 0);
  assert.equal(next.books[0].progress, 25);
  assert.equal(next.books[0].status, 'reading');
  assert.equal(next.books[0].notes, 'Private notes');
  assert.equal(next.books[0].review, 'Private review');
  assert.deepEqual(Object.keys(next.books[0].readingLog![0]).sort(), ['body', 'createdAt', 'id', 'progress']);
  const completed = appendReadingEntry(next, next.books[0].id, { ...first, id: 'log_complete', progress: 100, createdAt: '2026-10-23T10:00:00.000Z' });
  assert.equal(completed.books[0].status, 'read');
  assert.equal(completed.books[0].finishedAt, '2026-10-23T10:00:00.000Z');
  assert.deepEqual(completed.books[0].readingLog![0], first);
  const reread = appendReadingEntry(completed, completed.books[0].id, { ...first, id: 'log_reread', progress: 10 });
  assert.equal(reread.books[0].status, 'reading'); assert.equal(reread.books[0].finishedAt, undefined);
});

test('entry identity is unique across books and the per-book history limit is enforced', () => {
  const state = emptyState();
  const first = makeReadingEntry(state.books[0], { mode: 'percent', marker: '20', body: '' }, identity);
  const withEntry = appendReadingEntry(state, state.books[0].id, first);
  withEntry.books.push(newBook('Another story', 'Another writer'));
  assert.throws(() => appendReadingEntry(withEntry, withEntry.books[1].id, first), /already been saved/);
  assert.throws(() => appendReadingEntry(withEntry, 'removed_book', first), /no longer/);
  state.books[0].readingLog = Array.from({ length: READING_LOG_LIMIT }, (_, index) => ({ ...first, id: `log_${index}` }));
  assert.throws(() => appendReadingEntry(state, state.books[0].id, first), /200 reading updates/);
});
