import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCommunityReadDate } from '../lib/book-community';
import { catalogCSV, catalogJSON } from '../lib/export';
import { mergeBooks, mergeImportedBooks, parseCatalogJSON, parseGoodreadsCSV } from '../lib/import';
import { emptyState, newBook } from '../lib/types';

test('completed-read dates are real calendar days with a bounded timezone allowance', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z');
  for (const date of ['2024-02-29', '2026-10-22', '2026-10-23', '0001-01-01']) assert.equal(isCommunityReadDate(date, now), true, date);
  for (const date of ['2025-02-29', '2026-02-31', '2026-13-01', '2026-10-24', '0000-01-01', '2026-1-1', '2026-10-22T00:00:00Z', '', null, {}]) assert.equal(isCommunityReadDate(date, now), false, String(date));
});

test('JSON and CSV preserve work and selected edition identities without changing private book data', () => {
  const book = { ...newBook('A work', 'A writer'), catalogId: 'OL45804W', editionId: 'OL7353617M', review: 'My private review', notes: 'My private notes', rating: 3.5 };
  const state = { ...emptyState(), books: [book] };
  assert.deepEqual(parseCatalogJSON(catalogJSON(state)), state);
  const csv = parseGoodreadsCSV(catalogCSV([book])).books[0];
  assert.equal(csv.catalogId, book.catalogId); assert.equal(csv.editionId, book.editionId);
  assert.equal(csv.notes, book.notes); assert.equal(csv.review, book.review); assert.equal(csv.rating, 3.5);
  const manual = { ...newBook('Manual book'), catalogId: 'cs_' + 'a'.repeat(64) };
  assert.equal(parseCatalogJSON(catalogJSON({ ...emptyState(), books: [manual] })).books[0].catalogId, manual.catalogId);
});

test('backup rejects malformed or unpaired catalog identities and CSV reports skipped identities', () => {
  const original = { ...emptyState(), books: [{ ...newBook('A work'), catalogId: 'OL45804W', editionId: 'OL7353617M' }] };
  for (const mutate of [
    (value: typeof original) => { value.books[0].catalogId = '../private'; },
    (value: typeof original) => { value.books[0].catalogId = '/works/OL45804W'; },
    (value: typeof original) => { value.books[0].catalogId = 'OL0W'; },
    (value: typeof original) => { value.books[0].catalogId = 'cs_' + 'A'.repeat(64); },
    (value: typeof original) => { value.books[0].catalogId = 'cs_' + 'a'.repeat(64); },
    (value: typeof original) => { value.books[0].editionId = 'OL45804W'; },
  ]) {
    const broken = structuredClone(original); mutate(broken);
    assert.throws(() => parseCatalogJSON(catalogJSON(broken)), /identity/);
  }
  const csv = parseGoodreadsCSV('Title,Catalog ID,Edition ID\nManual,invalid,OL123M\n');
  assert.equal(csv.books[0].catalogId, undefined); assert.equal(csv.books[0].editionId, undefined);
  assert.equal(csv.warnings.length, 2);
});

test('imports keep different selected editions and homonymous known works separate', () => {
  const first = { ...newBook('Shared title', 'Shared writer'), catalogId: 'OL11W', editionId: 'OL11M' };
  const second = { ...newBook(first.title, first.author), catalogId: first.catalogId, editionId: 'OL12M' };
  const otherWork = { ...newBook(first.title, first.author), catalogId: 'OL12W' };
  const result = mergeBooks([first], [second, otherWork, { ...second, title: 'A renamed edition' }]);
  assert.equal(result.added, 2); assert.equal(result.duplicates, 1); assert.equal(result.books.length, 3);
  const roundtrip = parseGoodreadsCSV(catalogCSV([first, second, otherWork]));
  assert.equal(roundtrip.books.length, 3, 'A portable catalog must not lose an edition without an ISBN');
  const file = { ...second, sources: [{ id: 'file_source', kind: 'file' as const, label: 'EPUB', assetId: 'private_file' }] };
  const attached = mergeImportedBooks([first, second], [file]);
  assert.equal(attached.added, 0); assert.equal(attached.attached, 1);
  assert.equal(attached.books[0].sources.length, 0); assert.equal(attached.books[1].sources[0].assetId, 'private_file');
});
