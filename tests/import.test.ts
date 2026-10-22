import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoodreadsCSV, parseCatalogJSON, mergeBooks, mergeImportedBooks, readBookFile } from '../lib/import';
import { catalogJSON, catalogCSV, createBackupArchive } from '../lib/export';
import { createDemoState } from '../lib/demo';
import { newBook } from '../lib/types';

test('Goodreads CSV preserves multiline reviews, commas, escaped quotes, ISBN wrappers, and reading state', () => {
  const csv = '\uFEFFTitle,Author,ISBN13,My Rating,Exclusive Shelf,My Review,Date Read\r\n"A book, in parts",A. Writer,"=""9781234567890""",4.5,read,"Line one\nA ""quoted"" thought",2025/02/28\r\n';
  const { books, warnings } = parseGoodreadsCSV(csv);
  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'A book, in parts');
  assert.equal(books[0].isbn, '9781234567890');
  assert.equal(books[0].review, 'Line one\nA "quoted" thought');
  assert.equal(books[0].rating, 4.5);
  assert.equal(books[0].progress, 100);
  assert.equal(books[0].finishedAt, '2025-02-28T00:00:00.000Z');
  assert.deepEqual(books[0].sources, []);
  assert.deepEqual(warnings, []);
});

test('CSV rejects malformed quotes and missing title columns', () => {
  assert.throws(() => parseGoodreadsCSV('Title,Author\n"Unclosed,Writer'), /quoted field/);
  assert.throws(() => parseGoodreadsCSV('Book,Author\nSomething,Writer'), /Title column/);
});

test('CSV import skips empty titles and deduplicates without assuming ownership', () => {
  const result = parseGoodreadsCSV('Title,Author,My Rating,Exclusive Shelf\n,Unknown,0,to-read\nThe Book,Writer,0,to-read\n the book , Writer ,5,read\n');
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].status, 'unread');
  assert.equal(result.books[0].rating, null);
  assert.deepEqual(result.books[0].sources, []);
  assert.equal(result.warnings.length, 2);
});

test('re-import never overwrites existing notes or sources and keeps distinct editions', () => {
  const old = { ...newBook('A book', 'A writer'), isbn: '9781234567890', notes: 'Private existing note' };
  const duplicate = { ...newBook('Renamed edition', 'A writer'), isbn: old.isbn, notes: 'Imported note' };
  const otherEdition = { ...newBook('A book', 'A writer'), isbn: '9781234567891' };
  const result = mergeBooks([old], [duplicate, otherEdition]);
  assert.equal(result.added, 1); assert.equal(result.duplicates, 1);
  assert.equal(result.books[0].notes, 'Private existing note');
  assert.equal(result.books[1].isbn, '9781234567891');
});

test('file imports attach originals to existing books, deduplicate asset IDs, and preserve personal reading data', () => {
  const old = { ...newBook('A book', 'A writer'), isbn: '9781234567890', notes: 'My note', review: 'My review', status: 'read' as const, progress: 100, rating: 4 };
  const incoming = { ...newBook('A book', 'A writer'), isbn: old.isbn, notes: 'Imported note', coverUrl: '/api/assets/cover1', color: '#abcdef', sources: [{ id: 'file1', kind: 'file' as const, label: 'EPUB', assetId: 'asset1' }] };
  const result = mergeImportedBooks([old], [incoming, incoming]);
  assert.equal(result.added, 0); assert.equal(result.duplicates, 2); assert.equal(result.attached, 1);
  assert.equal(result.books[0].sources.length, 1);
  assert.equal(result.books[0].notes, 'My note'); assert.equal(result.books[0].review, 'My review');
  assert.equal(result.books[0].status, 'read'); assert.equal(result.books[0].rating, 4);
  assert.equal(result.books[0].coverUrl, '/api/assets/cover1'); assert.equal(result.books[0].color, '#abcdef');
  assert.equal(old.coverUrl, ''); assert.equal(old.sources.length, 0);
});

test('file import keeps distinct ISBN editions and never replaces an existing cover', () => {
  const original = { ...newBook('Book', 'Writer'), isbn: '9781234567890', coverUrl: 'https://example.org/cover.jpg', color: '#112233' };
  const otherEdition = { ...newBook('Book', 'Writer'), isbn: '9781234567891' };
  const file = { ...newBook('Book', 'Writer'), coverUrl: '/api/assets/newcover', color: '#445566', sources: [{ id: 's1', kind: 'file' as const, label: 'EPUB', assetId: 'newfile' }] };
  const result = mergeImportedBooks([original], [otherEdition, file]);
  assert.equal(result.added, 1); assert.equal(result.attached, 1);
  assert.equal(result.books[0].coverUrl, original.coverUrl); assert.equal(result.books[0].color, original.color);
});

test('JSON backup round-trips, strips sharing identity, and retains private file references', () => {
  const state = createDemoState();
  state.shelves[0].publicId = 'published_before';
  state.books[0].sources = [{ id: 'source_1', kind: 'file', label: 'EPUB', assetId: 'asset_private', filename: 'book.epub' }];
  const parsed = parseCatalogJSON(catalogJSON(state));
  assert.equal(parsed.shelves[0].publicId, undefined);
  assert.equal(parsed.books[0].sources[0].assetId, 'asset_private');
  assert.equal(parsed.books.length, state.books.length);
});

test('JSON restores published cover references and zero-page metadata within server limits', () => {
  const state = createDemoState();
  state.books[0].coverUrl = '/api/publications/shared_shelf/assets/public_cover'; state.books[0].pages = 0;
  const result = parseCatalogJSON(catalogJSON(state));
  assert.equal(result.books[0].coverUrl, state.books[0].coverUrl); assert.equal(result.books[0].pages, 0);
  state.profile.bio = 'a'.repeat(1001);
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /profile bio/);
});

test('JSON rejects unsafe links, unknown books, duplicate IDs, and unsupported formats', () => {
  const unsafe = createDemoState(); unsafe.books[0].coverUrl = 'javascript:alert(1)';
  assert.throws(() => parseCatalogJSON(JSON.stringify(unsafe)), /http or https/);
  const unknown = createDemoState(); unknown.shelves[0].items.find(item => item.kind === 'book')!.bookId = 'missing';
  assert.throws(() => parseCatalogJSON(JSON.stringify(unknown)), /missing from the catalog/);
  const duplicate = createDemoState(); duplicate.books[1].id = duplicate.books[0].id;
  assert.throws(() => parseCatalogJSON(JSON.stringify(duplicate)), /duplicate IDs/);
  assert.throws(() => parseCatalogJSON('{"schemaVersion":7}'), /unsupported format/);
});

test('JSON restore moves overflowing positions to the staging tray instead of losing books', () => {
  const state = createDemoState(); state.shelves[0].layout = 'gallery';
  const result = parseCatalogJSON(JSON.stringify(state));
  assert.equal(result.shelves[0].items.length, state.shelves[0].items.length);
  assert.ok(result.shelves[0].items.some(item => item.slot === null));
});

test('CSV export neutralizes spreadsheet formulas and preserves quotes and multiline text', () => {
  const book = { ...newBook('=SUM(A1:A2)', 'Some, Writer'), review: 'A "quote"\nand a line.' };
  const csv = catalogCSV([book]);
  assert.ok(csv.includes('"\'=SUM(A1:A2)"'));
  assert.ok(csv.includes('"A ""quote""\nand a line."'));
});

test('file reader verifies formats and falls back safely for unreadable EPUB details', async () => {
  await assert.rejects(() => readBookFile(new File(['no pdf'], 'book.pdf')), /does not appear to be a PDF/);
  await assert.rejects(() => readBookFile(new File(['bad'], 'book.txt')), /EPUB or PDF/);
  const epub = await readBookFile(new File([new Uint8Array([0x50, 0x4b, 0, 0])], 'An_old_book.epub'));
  assert.equal(epub.book.title, 'An old book');
  assert.ok(epub.warning);
  assert.deepEqual(epub.book.sources, []);
});

test('complete ZIP backup preserves original bytes, deduplicates assets, and includes a restore manifest', async () => {
  const state = createDemoState();
  state.books[0].sources = [{ id: 'source_1', kind: 'file', label: 'EPUB', assetId: 'asset_original', filename: 'My book.epub' }];
  state.books[1].sources = [{ ...state.books[0].sources[0], id: 'source_2' }];
  const originalFetch = globalThis.fetch, source = new Uint8Array([0x50, 0x4b, 0, 1, 255, 20]);
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return new Response(source, { headers: { 'content-type': 'application/epub+zip', 'content-disposition': 'attachment; filename="My book.epub"' } }); }) as typeof fetch;
  try {
    const bytes = new Uint8Array(await (await createBackupArchive(state)).arrayBuffer());
    const view = new DataView(bytes.buffer), entries = new Map<string, Uint8Array>();
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      const begin = offset + 30 + nameLength + extra;
      entries.set(name, bytes.slice(begin, begin + size)); offset = begin + size;
    }
    assert.equal(fetched, 1);
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
    assert.deepEqual(entries.get('files/0001-My book.epub'), source);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
    assert.equal(manifest.files[0].assetId, 'asset_original');
    assert.equal(JSON.parse(new TextDecoder().decode(entries.get('catalog.json'))).books.length, state.books.length);
  } finally { globalThis.fetch = originalFetch; }
});

test('complete backup fails clearly when an original file is no longer accessible', async () => {
  const state = createDemoState();
  state.books[0].sources = [{ id: 'source_1', kind: 'file', label: 'EPUB', assetId: 'missing', filename: 'My book.epub' }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
  try { await assert.rejects(() => createBackupArchive(state), /No partial backup was created/); }
  finally { globalThis.fetch = originalFetch; }
});
