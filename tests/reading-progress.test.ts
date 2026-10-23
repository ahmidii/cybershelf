import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBook } from '../lib/types';
import { bookReadingProgress, currentReadingPage, displayReadingProgress, pageCountPatch, readingPositionPatch, resolveReadingPosition } from '../lib/reading-progress';

test('page progress stores the full fraction while its display is rounded independently', () => {
  const position = resolveReadingPosition({ pages: 333 }, { mode: 'page', marker: '100' });
  assert.equal(position.progress, 100 / 333 * 100);
  assert.equal(position.page, 100);
  assert.equal(displayReadingProgress(position.progress), 30);
  const book = { ...newBook('A book'), ...readingPositionPatch(newBook('A book'), position) };
  assert.equal(currentReadingPage(book), 100);
  assert.ok(bookReadingProgress(book) < 30.031, 'The 30.031% thought stays beyond this bookmark');
});

test('first and final pages have exact boundaries, and the next-to-last page never completes a book', () => {
  assert.equal(resolveReadingPosition({ pages: 100000 }, { mode: 'page', marker: '0' }).progress, 0);
  assert.equal(resolveReadingPosition({ pages: 100000 }, { mode: 'page', marker: '100000' }).progress, 100);
  const progress = resolveReadingPosition({ pages: 100000 }, { mode: 'page', marker: '99999' }).progress;
  assert.ok(progress < 100);
  assert.equal(displayReadingProgress(progress), 99.9);
  assert.equal(displayReadingProgress(100), 100);
});

test('missing and invalid edition totals never derive a percentage from an existing bookmark', () => {
  for (const pages of [undefined, 0]) assert.throws(() => resolveReadingPosition({ pages }, { mode: 'page', marker: '15' }), /total pages once/);
  for (const totalPages of ['0', '-2', '1.5', '100001', 'Infinity']) assert.throws(() => resolveReadingPosition({}, { mode: 'page', marker: '15', totalPages }), /Total pages/);
  for (const marker of ['-1', '2.5', '401']) assert.throws(() => resolveReadingPosition({ pages: 400 }, { mode: 'page', marker }), /Choose a page/);
  assert.deepEqual(resolveReadingPosition({}, { mode: 'page', marker: '100', totalPages: '400' }), { page: 100, pages: 400, progress: 25 });
});

test('old percent-only bookmarks infer a conservative page without inventing exactness', () => {
  const book = { ...newBook('A book'), status: 'reading' as const, pages: 300, progress: 40.3 };
  assert.equal(currentReadingPage(book), 120);
  assert.equal(currentReadingPage({ ...book, currentPage: 121 }), 120);
  assert.equal(currentReadingPage({ ...book, currentPage: 120, progress: 40 }), 120);
  assert.equal(currentReadingPage({ ...book, pages: undefined }), undefined);
  assert.equal(currentReadingPage({ ...book, status: 'read' }), 300);
});

test('correcting total pages keeps an exact current page and recalculates its percentage', () => {
  const book = { ...newBook('A book'), status: 'reading' as const, pages: 200, currentPage: 50, progress: 25 };
  const next = { ...book, ...pageCountPatch(book, 400) };
  assert.equal(next.currentPage, 50);
  assert.equal(next.progress, 12.5);
  assert.equal(currentReadingPage(next), 50);
  const impossible = { ...book, ...pageCountPatch(book, 40) };
  assert.equal(impossible.currentPage, undefined);
  assert.equal(impossible.progress, 25);
  assert.equal(impossible.status, 'reading');
  assert.deepEqual(pageCountPatch(book, undefined), { pages: undefined, currentPage: undefined });
});

test('a longer corrected edition reopens an exact finished bookmark without changing saved journal entries', () => {
  const book = { ...newBook('A book'), status: 'read' as const, pages: 200, currentPage: 200, progress: 100, finishedAt: '2026-10-23', readingLog: [{ id: 'entry', body: 'Finished my old edition', progress: 100, page: 200, createdAt: '2026-10-23T00:00:00Z' }] };
  const next = { ...book, ...pageCountPatch(book, 400) };
  assert.equal(next.currentPage, 200); assert.equal(next.progress, 50); assert.equal(next.status, 'reading'); assert.equal(next.finishedAt, undefined);
  assert.equal(next.readingLog[0].progress, 100);
});

test('percentage mode remains available without a page count and replaces an old page only when progress changes', () => {
  const book = { ...newBook('A book'), status: 'reading' as const, pages: 320, currentPage: 100, progress: 31.25 };
  const same = readingPositionPatch(book, resolveReadingPosition(book, { mode: 'percent', marker: '31.25' }));
  assert.equal(same.currentPage, 100);
  const changed = readingPositionPatch(book, resolveReadingPosition(book, { mode: 'percent', marker: '42.25' }));
  assert.equal(changed.currentPage, undefined); assert.equal(changed.progress, 42.25);
  assert.equal(resolveReadingPosition({}, { mode: 'percent', marker: '12.5' }).progress, 12.5);
  for (const marker of ['', '-1', '100.1', 'NaN']) assert.throws(() => resolveReadingPosition({}, { mode: 'percent', marker }));
});
