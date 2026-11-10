import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSharedBookArtwork, sharedAssetMatchesEdition, sharedAssetIdFromUrl, sharedAssetImageUrl, type SharedAsset } from '../lib/shared-assets';

const spine: SharedAsset = { id: 'ca_fixture', kind: 'spine', title: 'An edition spine', description: '', tags: [], category: 'books', style: 'photographic',
  imageUrl: '/api/community-assets/ca_fixture/image', thumbnailUrl: '/api/community-assets/ca_fixture/image', width: 40, height: 400,
  defaultWidthMm: 20, defaultHeightMm: 200, anchorX: .5, anchorY: 1, creator: 'A contributor', sourceUrl: '', license: 'community-permission', licenseUrl: '/community-contributions',
  origin: 'community', status: 'approved', createdAt: '2026-11-10T00:00:00.000Z', edition: { catalogId: 'OL1W', editionId: 'OL1M', isbn: '9780140328721', isbns: ['9780140328721'] } };
test('shared artwork requires edition evidence and every known identifier must agree', () => {
  assert.equal(sharedAssetMatchesEdition(spine, { catalogId: 'OL1W' }), false);
  assert.equal(sharedAssetMatchesEdition(spine, { editionId: 'OL1M' }), true);
  assert.equal(sharedAssetMatchesEdition(spine, { isbn: '0140328726' }), true);
  assert.equal(sharedAssetMatchesEdition(spine, { editionId: 'OL1M', isbn: '9780980200447' }), false);
  assert.equal(sharedAssetMatchesEdition(spine, { editionId: 'OL2M', isbn: '9780140328721' }), false);
  assert.equal(sharedAssetMatchesEdition(spine, { catalogId: 'OL2W', editionId: 'OL1M' }), false);
  assert.equal(sharedAssetMatchesEdition({ edition: undefined }, { editionId: 'OL1M' }), false);
});
test('approved unambiguous artwork resolves while alternate variants require a reader choice', () => {
  const book = { id: 'bk_one', editionId: 'OL1M', isbn: '9780140328721' };
  assert.equal(matchSharedBookArtwork(book, [spine]).spine?.id, spine.id);
  assert.equal(matchSharedBookArtwork(book, [{ ...spine, status: 'pending' }]).spine, undefined);
  assert.deepEqual(matchSharedBookArtwork(book, [{ ...spine, status: 'withdrawn' }]).alternatives, []);
  const different = { ...spine, id: 'ca_variant', edition: { ...spine.edition, variant: 'Movie tie-in' } };
  const ambiguous = matchSharedBookArtwork(book, [spine, different]);
  assert.equal(ambiguous.spine, undefined); assert.equal(ambiguous.alternatives.length, 2);
  const cover = { ...spine, id: 'ca_cover', kind: 'cover' as const };
  assert.equal(matchSharedBookArtwork(book, [spine, cover]).spine?.id, spine.id);
  assert.equal(matchSharedBookArtwork(book, [spine, cover]).cover?.id, cover.id);
});
test('shared artwork URLs have one canonical public route with no private upload credentials', () => {
  assert.equal(sharedAssetIdFromUrl(sharedAssetImageUrl('ca_fixture')), 'ca_fixture');
  assert.equal(sharedAssetIdFromUrl('/api/community-assets/dc_plant/image'), 'dc_plant');
  for (const invalid of ['/api/assets/as_secret', '/api/community-assets/ca_fixture/image?token=private', '/api/community-assets/../image', 'https://example.invalid/api/community-assets/ca_fixture/image']) assert.equal(sharedAssetIdFromUrl(invalid), undefined);
});
