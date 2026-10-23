import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoodreadsCSV, parseCatalogJSON, mergeBooks, mergeImportedBooks, readBookFile } from '../lib/import';
import { catalogJSON, catalogCSV, createBackupArchive } from '../lib/export';
import { createDemoState } from '../lib/demo';
import { newBook, type ShelfItem } from '../lib/types';

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

test('exact page bookmarks survive JSON and CSV backups without percentage rounding', () => {
  const state = createDemoState(), book = state.books[0];
  book.status = 'reading'; book.pages = 333; book.currentPage = 100; book.progress = 100 / 333 * 100;
  const restored = parseCatalogJSON(catalogJSON(state)).books[0];
  assert.equal(restored.currentPage, 100); assert.equal(restored.pages, 333); assert.equal(restored.progress, book.progress);
  const csv = parseGoodreadsCSV(catalogCSV([book]));
  assert.deepEqual(csv.warnings, []);
  assert.equal(csv.books[0].currentPage, 100); assert.equal(csv.books[0].progress, book.progress);
  const zero = parseGoodreadsCSV('Title,Number of Pages,Current Page\nA book,300,0\n').books[0];
  assert.equal(zero.currentPage, 0); assert.equal(zero.progress, 0);
  const pageOnly = parseGoodreadsCSV('Title,Number of Pages,Current Page\nA book,300,150\n').books[0];
  assert.equal(pageOnly.currentPage, 150); assert.equal(pageOnly.progress, 50); assert.equal(pageOnly.status, 'reading');
});

test('invalid backup page markers are rejected and invalid CSV markers do not erase progress', () => {
  const state = createDemoState();
  for (const page of [-1, 1.5, 100001]) {
    state.books[0].currentPage = page;
    assert.throws(() => parseCatalogJSON(catalogJSON(state)), /current page/);
  }
  const csv = parseGoodreadsCSV('Title,Number of Pages,Current Page,Progress\nA book,300,301,25\n');
  assert.equal(csv.books[0].currentPage, undefined); assert.equal(csv.books[0].progress, 25); assert.equal(csv.warnings.length, 1);
});

test('JSON restores published cover references and zero-page metadata within server limits', () => {
  const state = createDemoState();
  state.books[0].coverUrl = '/api/publications/shared_shelf/assets/public_cover'; state.books[0].pages = 0;
  const result = parseCatalogJSON(catalogJSON(state));
  assert.equal(result.books[0].coverUrl, state.books[0].coverUrl); assert.equal(result.books[0].pages, 0);
  state.profile.bio = 'a'.repeat(1001);
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /profile bio/);
});

test('book appearance, lean, and featured shelf survive backup without restoring public identities', () => {
  const state = createDemoState();
  state.books[0].dimensions = { heightMm: 220, widthMm: 145, thicknessMm: 28, source: 'manual' };
  state.books[0].format = 'hardcover'; state.books[0].spineUrl = '/api/assets/private_spine';
  state.books[1].spineUrl = '/api/profiles/public_profile/assets/public_spine';
  state.shelves[0].items[0].lean = 'left'; state.shelves[0].publicId = 'old_publication';
  state.profile.featuredShelfId = state.shelves[0].id;
  const result = parseCatalogJSON(catalogJSON(state));
  assert.deepEqual(result.books[0].dimensions, state.books[0].dimensions);
  assert.equal(result.books[0].format, 'hardcover');
  assert.equal(result.books[0].spineUrl, state.books[0].spineUrl);
  assert.equal(result.books[1].spineUrl, state.books[1].spineUrl);
  assert.equal(result.shelves[0].items[0].lean, 'left');
  assert.equal(result.profile.featuredShelfId, state.shelves[0].id);
  assert.equal(result.shelves[0].publicId, undefined);
  state.profile.featuredShelfId = 'deleted_shelf';
  assert.equal(parseCatalogJSON(catalogJSON(state)).profile.featuredShelfId, undefined);
  state.books[0].dimensions.thicknessMm = 1000;
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /spine thickness/);
});

test('CSV appearance fields round-trip with unit bounds and unsafe image rejection', () => {
  const book = newBook('An edition', 'A reader');
  book.format = 'pocket'; book.color = '#123456';
  book.dimensions = { heightMm: 178, widthMm: 110, thicknessMm: 21, source: 'manual' };
  book.spineUrl = 'https://example.org/spine.jpg'; book.coverUrl = 'https://example.org/cover.jpg';
  const result = parseGoodreadsCSV(catalogCSV([book])).books[0];
  assert.deepEqual(result.dimensions, book.dimensions);
  assert.equal(result.spineUrl, book.spineUrl); assert.equal(result.format, book.format); assert.equal(result.color, book.color);
  const unsafe = parseGoodreadsCSV('Title,Height (mm),Cover Width (mm),Spine Thickness (mm),Spine Image URL\nBook,200,130,999,javascript:alert(1)\n');
  assert.equal(unsafe.books[0].dimensions, undefined); assert.equal(unsafe.books[0].spineUrl, undefined);
  assert.equal(unsafe.warnings.length, 2);
});

test('complete backup includes a private spine once even when also used as cover art', async () => {
  const state = createDemoState();
  state.books[0].spineUrl = '/api/assets/spine_1'; state.books[1].coverUrl = '/api/assets/spine_1';
  const originalFetch = globalThis.fetch; const paths: string[] = [];
  globalThis.fetch = (async (path: RequestInfo | URL) => { paths.push(String(path)); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); }) as typeof fetch;
  try { const archive = await createBackupArchive(state); assert.ok(archive.size > 3); assert.deepEqual(paths, ['/api/assets/spine_1']); }
  finally { globalThis.fetch = originalFetch; }
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

test('continuous shelf positions and stacks round-trip beyond the former gallery slot limit', () => {
  const state=createDemoState();
  const shelf=state.shelves[0];shelf.layout='gallery';
  shelf.items=shelf.items.filter(item=>item.kind==='book').slice(0,6).map((item,index)=>({
    ...item,slot:100+index,facing:index<2?'stack':'spine',placement:{row:0,x:index<2?.2:.25+index*.12},
  }));
  shelf.items[1].placement!.supportId=shelf.items[0].id;
  state.shelves=[shelf];
  const raw=JSON.parse(catalogJSON(state));raw.shelves[0].items[0].placement.privateField='DO_NOT_RESTORE';
  const result=parseCatalogJSON(JSON.stringify(raw));
  assert.deepEqual(result.shelves[0].items.map(item=>item.placement),shelf.items.map(item=>item.placement));
  assert.deepEqual(result.shelves[0].items.map(item=>item.slot),[100,101,102,103,104,105]);
  assert.equal(JSON.stringify(result).includes('DO_NOT_RESTORE'),false);
});

test('backup import rejects invalid continuous positions and unsafe support graphs', () => {
  const state=createDemoState(),shelf=state.shelves[0];
  shelf.items=shelf.items.filter(item=>item.kind==='book').slice(0,2).map((item,index)=>({
    ...item,slot:40+index,facing:'stack',placement:{row:0,x:.4},
  }));
  state.shelves=[shelf];
  for(const mutate of [
    (items:ShelfItem[])=>items[0].placement!.x=-.01,
    (items:ShelfItem[])=>items[0].placement!.x=1.01,
    (items:ShelfItem[])=>items[0].placement!.x=Infinity,
    (items:ShelfItem[])=>items[0].placement!.row=3,
    (items:ShelfItem[])=>items[0].placement!.row=.5,
    (items:ShelfItem[])=>items[0].placement!.supportId='missing',
    (items:ShelfItem[])=>items[0].placement!.supportId=items[0].id,
    (items:ShelfItem[])=>{items[0].placement!.supportId=items[1].id;items[1].placement!.row=1;},
    (items:ShelfItem[])=>{items[0].placement!.supportId=items[1].id;items[1].placement!.supportId=items[0].id;},
    (items:ShelfItem[])=>items[0].slot=null,
    (items:ShelfItem[])=>items[0].slot=1001,
  ]){
    const invalid=JSON.parse(catalogJSON(state));mutate(invalid.shelves[0].items);
    assert.throws(()=>parseCatalogJSON(JSON.stringify(invalid)),/Invalid backup/);
  }
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

test('private reading logs round-trip through JSON and CSV without restoring public post identities', () => {
  const state = createDemoState();
  const entries = [
    { id: 'log_first', body: 'A thought, with a "quote"\nand a second line.', page: 42, progress: 18.5, createdAt: '2026-10-22T09:30:00.000Z' },
    { id: 'log_second', body: '', progress: 50, createdAt: '2026-10-23T10:00:00.000Z' },
  ];
  state.books[0].readingLog = entries;
  state.books[0].coverUrl = '/api/journal/shared_post/assets/public_cover';
  state.books[0].spineUrl = '/api/journal/shared_post/assets/public_spine';
  const poisoned = JSON.parse(catalogJSON(state));
  poisoned.books[0].readingLog[0].postId = 'public_post_not_restored';
  poisoned.books[0].readingLog[0].published = true;
  poisoned.books[0].readingLog[0].comments = [{ body: 'This is external data' }];
  poisoned.profile.publicId = 'public_profile_not_restored';
  const restored = parseCatalogJSON(JSON.stringify(poisoned));
  assert.deepEqual(restored.books[0].readingLog, entries);
  assert.equal(restored.books[0].coverUrl, state.books[0].coverUrl);
  assert.equal(restored.books[0].spineUrl, state.books[0].spineUrl);
  assert.equal('publicId' in restored.profile, false);
  const csv = parseGoodreadsCSV(catalogCSV([state.books[0]]));
  assert.deepEqual(csv.books[0].readingLog, entries);
  assert.deepEqual(csv.warnings, []);
  assert.equal(parseCatalogJSON(catalogJSON(createDemoState())).books[0].readingLog, undefined);
});

test('JSON reading logs validate counts, global identity, progress, pages, dates, and thought bounds', () => {
  const state = createDemoState();
  const entry = { id: 'log_one', body: '', progress: 20, createdAt: '2026-10-22T09:30:00.000Z' };
  const invalid = (change: Record<string, unknown>) => {
    const value = JSON.parse(catalogJSON(state));
    value.books[0].readingLog = [{ ...entry, ...change }];
    return () => parseCatalogJSON(JSON.stringify(value));
  };
  for (const progress of [-1, 101, '30', null]) assert.throws(invalid({ progress }), /progress/);
  for (const page of [-1, 100001, 1.5, '10']) assert.throws(invalid({ page }), /page/);
  assert.throws(invalid({ body: 'x'.repeat(4001) }), /thought/);
  assert.throws(invalid({ createdAt: 'invalid' }), /date/);
  assert.throws(invalid({ id: 'with spaces' }), /identifier/);
  state.books[0].readingLog = [entry]; state.books[1].readingLog = [{ ...entry }];
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /duplicate IDs/);
  state.books[1].readingLog = undefined;
  state.books[0].readingLog = Array.from({ length: 201 }, (_, index) => ({ ...entry, id: `log_${index}` }));
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /at most 200/);
});

test('CSV keeps a complete bounded reading log and skips malformed log fields without losing the book', () => {
  const book = newBook('Long reading life', 'A writer');
  book.readingLog = Array.from({ length: 200 }, (_, index) => ({ id: `log_${index}`, body: 'a'.repeat(4000), progress: index / 2, createdAt: '2026-10-22T09:30:00.000Z' }));
  const roundTrip = parseGoodreadsCSV(catalogCSV([book]));
  assert.deepEqual(roundTrip.books[0].readingLog, book.readingLog);
  assert.deepEqual(roundTrip.warnings, []);
  const bad = parseGoodreadsCSV('Title,Author,Reading Log\nA book,A writer,"[{""id"":""log_1"",""progress"":101}]"\n');
  assert.equal(bad.books.length, 1);
  assert.equal(bad.books[0].readingLog, undefined);
  assert.match(bad.warnings[0], /invalid reading log/);
});

test('merging an imported copied log gives collisions a fresh private identity and preserves existing history', () => {
  const entry = { id: 'log_shared_private_id', body: 'The same old thought', progress: 30, createdAt: '2026-10-22T09:30:00.000Z' };
  const existing = { ...newBook('One book', 'A writer'), readingLog: [entry] };
  const incoming = { ...newBook('Another book', 'A writer'), readingLog: [{ ...entry }] };
  const merged = mergeBooks([existing], [incoming]);
  assert.equal(merged.books[0].readingLog![0].id, entry.id);
  assert.notEqual(merged.books[1].readingLog![0].id, entry.id);
  assert.equal(merged.books[1].readingLog![0].body, entry.body);
  assert.equal(incoming.readingLog[0].id, entry.id);
  const fileMerged = mergeImportedBooks([existing], [incoming]);
  assert.notEqual(fileMerged.books[1].readingLog![0].id, entry.id);
});
