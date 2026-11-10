import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, newBook, newShelf, type AppState, type Book } from '../lib/types';
import { applyCommunityArtworkMatches, artworkLookupIdentity, selectCommunityArtwork, usesAutomaticSpine } from '../lib/community-artwork';
import { clearEditionArtwork } from '../lib/spine-image';
import { matchSharedBookArtwork, sharedAssetImageUrl, type SharedAsset } from '../lib/shared-assets';
import { catalogCSV, catalogJSON } from '../lib/export';
import { parseCatalogJSON, parseGoodreadsCSV } from '../lib/import';
import { decorSize } from '../lib/shelf-geometry';

const makeBook = (patch: Partial<Book> = {}): Book => ({ ...newBook('A shared story', 'A writer'), id: 'bk_artwork', catalogId: 'OL123W', editionId: 'OL123M', isbn: '9780140328721', ...patch });
const makeAsset = (patch: Partial<SharedAsset> = {}): SharedAsset => ({
  id: 'ca_spine', kind: 'spine', title: 'Spine photograph', description: '', creator: 'A reader', sourceUrl: '',
  tags: [], category: 'other', style: 'photographic', imageUrl: sharedAssetImageUrl('ca_spine'), thumbnailUrl: sharedAssetImageUrl('ca_spine'),
  width: 100, height: 1000, defaultWidthMm: 20, defaultHeightMm: 200, anchorX: .5, anchorY: 1,
  license: 'community-permission', licenseUrl: '/community-contributions', origin: 'community', status: 'approved', createdAt: '2026-11-10T00:00:00.000Z',
  edition: { catalogId: 'OL123W', editionId: 'OL123M', isbn: '9780140328721' }, ...patch,
});
const library = (book: Book): AppState => ({ ...emptyState(), books: [book] });
const expected = (book: Book) => new Map([[book.id, artworkLookupIdentity(book)]]);

test('another reader receives an approved edition spine without changing their private reading record', () => {
  const book = makeBook({ notes: 'Private notes', progress: 42, currentPage: 84, review: 'My review' }), asset = makeAsset(), state = library(book);
  const next = applyCommunityArtworkMatches(state, [matchSharedBookArtwork(book, [asset])], expected(book));
  assert.equal(next.books[0].spineAssetId, asset.id); assert.equal(next.books[0].spineUrl, sharedAssetImageUrl(asset.id));
  assert.equal(next.books[0].spineMode, 'auto'); assert.equal(next.books[0].notes, book.notes); assert.equal(next.books[0].currentPage, 84); assert.equal(next.books[0].progress, 42);
  assert.equal(applyCommunityArtworkMatches(next, [matchSharedBookArtwork(book, [asset])], expected(next.books[0])), next, 'Repeated lookup does not dirty the library');
});

test('personal images, legacy image links and typographic choices do not become automatic replacements', () => {
  for (const book of [makeBook({ spineUrl: '/api/assets/as_mine' }), makeBook({ spineUrl: 'https://example.org/spine.jpg', spineMode: 'custom' }), makeBook({ spineMode: 'typographic' })]) {
    const state = library(book);
    assert.equal(usesAutomaticSpine(book), false);
    assert.equal(applyCommunityArtworkMatches(state, [matchSharedBookArtwork(book, [makeAsset()])], expected(book)), state);
  }
});

test('an in-flight lookup cannot replace a newly chosen personal image or land on a changed edition', () => {
  const original = makeBook(), match = matchSharedBookArtwork(original, [makeAsset()]);
  const personal = library({ ...original, spineUrl: '/api/assets/as_new', spineMode: 'custom' });
  assert.equal(applyCommunityArtworkMatches(personal, [match], expected(original)), personal);
  const otherEdition = library({ ...original, editionId: 'OL456M', isbn: '9780061120084' });
  assert.equal(applyCommunityArtworkMatches(otherEdition, [match], expected(original)), otherEdition);
  assert.equal(selectCommunityArtwork(otherEdition.books[0], makeAsset()), otherEdition.books[0]);
});

test('multiple variants need a choice while an already selected approved variant stays put', () => {
  const book = makeBook(), assets = [makeAsset(), makeAsset({ id: 'ca_blue', edition: { editionId: 'OL123M', isbn: book.isbn, variant: 'Blue cover' } })];
  const match = matchSharedBookArtwork(book, assets), state = library(book);
  assert.equal(match.spine, undefined); assert.equal(applyCommunityArtworkMatches(state, [match], expected(book)), state);
  const selected = library(selectCommunityArtwork(book, assets[0], true));
  assert.equal(applyCommunityArtworkMatches(selected, [match], expected(selected.books[0])), selected);
});

test('withdrawn shared art falls back without removing a personal source or erasing notes', () => {
  const original = makeBook({ sources: [{ id: 'src_book', kind: 'file', label: 'My original', assetId: 'as_original' }], notes: 'Keep me' });
  const selected = selectCommunityArtwork(original, makeAsset());
  const next = applyCommunityArtworkMatches(library(selected), [{ bookId: original.id, alternatives: [] }], expected(selected));
  assert.equal(next.books[0].spineUrl, undefined); assert.equal(next.books[0].spineAssetId, undefined);
  assert.equal(next.books[0].sources[0].assetId, 'as_original'); assert.equal(next.books[0].notes, 'Keep me');
});

test('automatic artwork can adopt another approved image after withdrawal, but not pending artwork', () => {
  const book = selectCommunityArtwork(makeBook(), makeAsset(), true), replacement = makeAsset({ id: 'ca_replacement' });
  const next = applyCommunityArtworkMatches(library(book), [matchSharedBookArtwork(book, [replacement])], expected(book));
  assert.equal(next.books[0].spineAssetId, replacement.id);
  assert.equal(selectCommunityArtwork(makeBook(), makeAsset({ status: 'pending' })).spineAssetId, undefined);
});

test('an older resolver response cannot revoke a newly selected shared variant or cover', () => {
  const original = selectCommunityArtwork(makeBook(), makeAsset());
  const freshSpine = selectCommunityArtwork(original, makeAsset({ id: 'ca_fresh' }));
  const oldResult = matchSharedBookArtwork(original, [makeAsset()]);
  const changed = library(freshSpine);
  assert.equal(applyCommunityArtworkMatches(changed, [oldResult], expected(original)), changed);
  const freshCover = selectCommunityArtwork(original, makeAsset({ id: 'ca_fresh_cover', kind: 'cover' }));
  const changedCover = library(freshCover);
  assert.equal(applyCommunityArtworkMatches(changedCover, [oldResult], expected(original)), changedCover);
});

test('new community covers fill a missing cover without overwriting a chosen cover', () => {
  const cover = makeAsset({ id: 'ca_cover', kind: 'cover' });
  const blank = makeBook();
  assert.equal(applyCommunityArtworkMatches(library(blank), [matchSharedBookArtwork(blank, [cover])], expected(blank)).books[0].coverAssetId, cover.id);
  const personal = makeBook({ coverUrl: '/api/assets/as_my_cover' }), state = library(personal);
  assert.equal(applyCommunityArtworkMatches(state, [matchSharedBookArtwork(personal, [cover])], expected(personal)), state);
});

test('an edition change clears shared identities while retaining a newly supplied provider cover', () => {
  const book = selectCommunityArtwork(makeBook(), makeAsset()); book.coverAssetId = 'ca_cover'; book.coverUrl = sharedAssetImageUrl('ca_cover');
  const cleared = { ...book, ...clearEditionArtwork(book) };
  assert.equal(cleared.spineAssetId, undefined); assert.equal(cleared.coverAssetId, undefined); assert.equal(cleared.coverUrl, '');
  assert.equal({ ...book, coverUrl: 'https://example.org/new.jpg', ...clearEditionArtwork({ ...book, coverUrl: 'https://example.org/new.jpg' }) }.coverUrl, 'https://example.org/new.jpg');
});

test('JSON and CSV backups retain reusable artwork identities and personal artwork preferences', () => {
  const book = selectCommunityArtwork(makeBook(), makeAsset());
  const shelf = newShelf(); shelf.items = [{ id: 'it_plant', kind: 'decor', decor: 'image', sharedAssetId: 'dc_plant', imageUrl: sharedAssetImageUrl('dc_plant'), label: 'Plant', decorWidthMm: 80, decorHeightMm: 150, decorFlip: true, slot: 0, pinned: false, facing: 'auto' }];
  const state = { ...library(book), shelves: [shelf] }, restored = parseCatalogJSON(catalogJSON(state));
  assert.equal(restored.books[0].spineAssetId, book.spineAssetId); assert.equal(restored.books[0].spineMode, 'custom');
  assert.equal(restored.shelves[0].items[0].sharedAssetId, 'dc_plant'); assert.equal(restored.shelves[0].items[0].decorFlip, true);
  assert.deepEqual(decorSize(restored.shelves[0].items[0]), { width: 80, height: 150 });
  const csv = parseGoodreadsCSV(catalogCSV([book]));
  assert.equal(csv.books[0].spineAssetId, book.spineAssetId); assert.equal(csv.books[0].spineMode, 'custom');
});

test('backup validation rejects a shared ID attached to private image bytes or unbounded decor geometry', () => {
  const state = library(makeBook({ spineAssetId: 'ca_other', spineUrl: '/api/assets/as_private' }));
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /shared artwork/);
  state.books = [makeBook()];
  const shelf = newShelf(); shelf.items = [{ id: 'it_large', kind: 'decor', decor: 'plant', decorHeightMm: 100000, slot: 0, pinned: false, facing: 'auto' }]; state.shelves = [shelf];
  assert.throws(() => parseCatalogJSON(catalogJSON(state)), /decoration height/);
});
