import test from 'node:test';
import assert from 'node:assert/strict';
import { newBook, type Book } from '../lib/types';
import { ownReadingCopy, pageFirstViewInput, viewReadingBook } from '../lib/reading-view';

const publicBook = { title: 'A reading life', author: 'M. Reader', pages: 900 };
const copy = (patch: Partial<Book> = {}) => ({ ...newBook(publicBook.title, publicBook.author), status: 'reading' as const, ...patch });

test('public reading controls never borrow another reader’s edition page count', () => {
  assert.equal(viewReadingBook(publicBook, [], 35).pages, undefined);
  assert.equal(viewReadingBook(publicBook, [copy({ pages: 320 })], 35).pages, 320);
  assert.equal(viewReadingBook(publicBook, [copy({ title: 'A different reading life', pages: 200 })], 35).pages, undefined);
});

test('the input edition follows the same most-advanced own copy as the saved spoiler ceiling', () => {
  const older = copy({ id: 'older', pages: 250, progress: 20 });
  const reading = copy({ id: 'reading', pages: 400, progress: 50 });
  assert.equal(ownReadingCopy(publicBook, [older, reading])?.id, 'reading');
  assert.equal(viewReadingBook(publicBook, [older, reading], 50).pages, 400);
  assert.equal(ownReadingCopy(publicBook, [reading, { ...older, status: 'read' }])?.id, 'older');
});

test('an equally advanced copy with a known page count is preferred without mutating the library', () => {
  const unknown = copy({ id: 'unknown', progress: 25 });
  const known = copy({ id: 'known', progress: 25, pages: 280 });
  const books = [unknown, known];
  assert.equal(ownReadingCopy(publicBook, books)?.id, 'known');
  assert.deepEqual(books.map(book => book.id), ['unknown', 'known']);
});

test('local page totals are accepted only when the viewer’s selected copy lacks a valid total', () => {
  assert.equal(viewReadingBook(publicBook, [], 20, 310).pages, 310);
  assert.equal(viewReadingBook(publicBook, [copy()], 20, 310).pages, 310);
  assert.equal(viewReadingBook(publicBook, [copy({ pages: 275 })], 20, 310).pages, 275);
  for (const invalid of [0, -1, 10.5, Number.NaN, 100001]) assert.equal(viewReadingBook(publicBook, [], 20, invalid).pages, undefined);
});

test('view input suggestions preserve the exact active fraction and never round to a later page', () => {
  const progress = 100 / 3;
  const book = viewReadingBook(publicBook, [copy({ pages: 320 })], progress);
  assert.equal(book.progress, progress);
  assert.deepEqual(pageFirstViewInput(book), { mode: 'page', marker: '106' });
  assert.equal(book.progress, progress);
});

test('unknown totals ask for an actual page and completed own copies suggest their final page', () => {
  assert.deepEqual(pageFirstViewInput(viewReadingBook(publicBook, [], 20)), { mode: 'page', marker: '' });
  assert.deepEqual(pageFirstViewInput(viewReadingBook(publicBook, [copy({ pages: 320 })], 100)), { mode: 'page', marker: '320' });
});
