import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDimensions, editionAppearance, normalizeBookISBN, parseCatalogDimensions, validBookDimensions } from '../lib/book-size';

test('automatic book proportions are stable, respond to format and page count, and stay bounded', () => {
  const thin = bookDimensions({ pages: 100 });
  const thick = bookDimensions({ pages: 700 });
  assert.equal(thin.heightMm, thick.heightMm);
  assert.equal(thin.widthMm, thick.widthMm);
  assert.ok(thin.thicknessMm < thick.thicknessMm);
  assert.equal(thin.source, 'estimated');
  assert.deepEqual(bookDimensions({}), bookDimensions({ pages: 0 }));
  assert.ok(bookDimensions({ format: 'hardcover' }).heightMm > bookDimensions({ format: 'pocket' }).heightMm);
  assert.equal(bookDimensions({ pages: 100000 }).thicknessMm, 150);
  assert.ok(validBookDimensions(bookDimensions({ pages: Number.NaN })));
});

test('stored measured or custom dimensions win without mutating the catalog record', () => {
  const dimensions = { heightMm: 217, widthMm: 147, thicknessMm: 33.5, source: 'manual' as const };
  const result = bookDimensions({ dimensions, pages: 80, format: 'pocket' });
  assert.deepEqual(result, dimensions);
  result.heightMm = 300;
  assert.equal(dimensions.heightMm, 217);
  assert.equal(bookDimensions({ dimensions: { ...dimensions, thicknessMm: -4 } }).source, 'estimated');
  assert.equal(validBookDimensions({ ...dimensions, widthMm: Infinity }), false);
});

test('catalog measurement parser respects labelled axes and units without claiming ambiguous triples are measured', () => {
  assert.deepEqual(parseCatalogDimensions('height: 21 cm, width: 140 mm, thickness: 1 inch'), { heightMm: 210, widthMm: 140, thicknessMm: 25.4, source: 'catalog' });
  assert.deepEqual(parseCatalogDimensions('5.5 x 8.5 x 0.8 inches (W x H x D)'), { heightMm: 215.9, widthMm: 139.7, thicknessMm: 20.3, source: 'catalog' });
  assert.deepEqual(parseCatalogDimensions('21 × 14 × 2.5 centimeters'), { heightMm: 210, widthMm: 140, thicknessMm: 25, source: 'estimated' });
  for (const value of ['21 cm', '21 x 14 cm', '21 x 14 x 2.5', '5 x 9 x 1 inches', '90 x 50 x 20 centimeters', '10 x 8 x .5 parsecs', 'height: 21 cm, height: 22 cm, width: 14 cm, depth: 3 cm']) assert.equal(parseCatalogDimensions(value), undefined, value);
});

test('ISBN lookup requires a valid checksum and the returned record must identify the requested edition', () => {
  assert.equal(normalizeBookISBN('978-0-14-032872-1'), '9780140328721');
  assert.equal(normalizeBookISBN('0140328726'), '0140328726');
  assert.equal(normalizeBookISBN('9780140328722'), undefined);
  assert.equal(normalizeBookISBN('../private'), undefined);
  const data = { isbn_13: ['9780140328721'], physical_format: 'Paperback', number_of_pages: 96, physical_dimensions: 'height: 20 cm, width: 13 cm, depth: 1 cm', covers: [-1, 15152634] };
  assert.equal(editionAppearance(data, '9780140328721')?.dimensions?.source, 'catalog');
  assert.equal(editionAppearance(data, '9780140328721')?.format, 'paperback');
  assert.equal(editionAppearance(data, '9780140328721')?.coverUrl, 'https://covers.openlibrary.org/b/id/15152634-M.jpg');
  assert.equal(editionAppearance(data, '9780980200447'), undefined);
  assert.equal(editionAppearance({ ...data, isbn_13: undefined }, '9780140328721'), undefined);
  assert.equal(editionAppearance({ ...data, isbn_13: undefined, isbn_10: ['0140328726'] }, '9780140328721')?.pages, 96);
});
