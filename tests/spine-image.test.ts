import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSpineRatio, spineCopyIdentity, spineCropGeometry, spineEditionChanged, validSpineImage } from '../lib/spine-image';

test('spine artwork stays with a copy when equivalent ISBN formats or a first identity are added', () => {
  assert.equal(spineEditionChanged({ isbn: '0140328726' }, { isbn: '978-0-14-032872-1' }), false);
  assert.equal(spineEditionChanged({}, { isbn: '9780140328721', editionId: 'OL1M' }), false);
  assert.equal(spineEditionChanged({ isbn: '9780140328721' }, {}), false);
  assert.equal(spineEditionChanged({ editionId: 'OL1M' }, { editionId: 'OL2M' }), true);
  assert.equal(spineEditionChanged({ isbn: '9780140328721' }, { isbn: '9780980200447' }), true);
  assert.equal(spineEditionChanged({ catalogId: 'OL1W' }, { catalogId: 'OL2W' }), true);
  assert.equal(spineCopyIdentity({ id: 'bk_1', isbn: '0140328726' }), spineCopyIdentity({ id: 'bk_1', isbn: '9780140328721' }));
  assert.notEqual(spineCopyIdentity({ id: 'bk_1', editionId: 'OL1M' }), spineCopyIdentity({ id: 'bk_1', editionId: 'OL2M' }));
  assert.notEqual(spineCopyIdentity({ id: 'bk_1' }), spineCopyIdentity({ id: 'bk_2' }));
});

test('spine links allow public image URLs and scoped asset paths without credential-bearing or executable URLs', () => {
  for (const url of ['', '/api/assets/as_image', '/api/publications/pub_1/assets/as_image', '/api/profiles/pro_1/assets/as_image', '/api/journal/log_1/assets/as_image', 'https://images.example/spine.jpg', 'https://images.example/image?id=7']) assert.equal(validSpineImage(url), true, url);
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'blob:https://example.test/1', '/api/assets/../private', '//example.test/spine.jpg', 'https://reader:secret@example.test/spine.jpg', 'https://example.test/\nspine.jpg', 'https://example.test/a b.jpg', '/api/assets/asset?token=secret']) assert.equal(validSpineImage(url), false, url);
});

test('crop bounds cover the entire spine after dragging to any edge, zooming, and rotating', () => {
  for (const [imageWidth, imageHeight] of [[3000, 2000], [900, 3600], [400, 400]]) {
    for (const turns of [0, 1, 2, 3, -1, 5]) {
      for (const zoom of [1, 2.4, 6]) {
        for (const sign of [-1, 1]) {
          const frameWidth = 40, frameHeight = 264;
          const result = spineCropGeometry({ imageWidth, imageHeight, frameWidth, frameHeight, turns, zoom, offsetX: sign * 10000, offsetY: sign * 10000 });
          const rotatedWidth = result.rotation % 180 ? imageHeight : imageWidth;
          const rotatedHeight = result.rotation % 180 ? imageWidth : imageHeight;
          const left = result.offsetX - rotatedWidth * result.scale / 2;
          const right = result.offsetX + rotatedWidth * result.scale / 2;
          const top = result.offsetY - rotatedHeight * result.scale / 2;
          const bottom = result.offsetY + rotatedHeight * result.scale / 2;
          assert.ok(left <= -frameWidth / 2 + 1e-7 && right >= frameWidth / 2 - 1e-7);
          assert.ok(top <= -frameHeight / 2 + 1e-7 && bottom >= frameHeight / 2 - 1e-7);
          assert.ok(Number.isFinite(result.scale) && result.scale > 0);
        }
      }
    }
  }
});

test('crop calculations bound unusual input and reject unreadable dimensions', () => {
  const base = { imageWidth: 1200, imageHeight: 2400, frameWidth: 36, frameHeight: 264, turns: 0, zoom: 1, offsetX: 0, offsetY: 0 };
  const sane = spineCropGeometry(base);
  assert.deepEqual(spineCropGeometry({ ...base, turns: Number.NaN, zoom: Number.NaN, offsetX: Infinity, offsetY: Number.NaN }), sane);
  assert.deepEqual(spineCropGeometry({ ...base, zoom: -2 }), sane);
  assert.deepEqual(spineCropGeometry({ ...base, zoom: 20 }), spineCropGeometry({ ...base, zoom: 6 }));
  assert.throws(() => spineCropGeometry({ ...base, imageWidth: 0 }), /readable dimensions/);
  assert.throws(() => spineCropGeometry({ ...base, imageHeight: Infinity }), /readable dimensions/);
  assert.equal(clampSpineRatio(0), .025);
  assert.equal(clampSpineRatio(100), .5);
  assert.equal(clampSpineRatio(Number.NaN), .12);
});
