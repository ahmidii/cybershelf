import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyShelfItems, withoutShelfItems } from '../lib/shelf-actions';
import { newShelf, type ShelfItem } from '../lib/types';

const pile = (): ShelfItem[] => [
  { id: 'a', kind: 'book', bookId: 'book-a', slot: 0, pinned: false, facing: 'stack', placement: { row: 0, x: .4 } },
  { id: 'b', kind: 'book', bookId: 'book-b', slot: 1, pinned: false, facing: 'stack', placement: { row: 0, x: .4, supportId: 'a' } },
  { id: 'c', kind: 'book', bookId: 'book-c', slot: 2, pinned: false, facing: 'stack', placement: { row: 0, x: .4, supportId: 'b' } },
];

test('removing a middle book reconnects the pile without changing unrelated books', () => {
  const shelf = { ...newShelf(), items: pile() };
  const result = withoutShelfItems(shelf, ['b']);
  assert.deepEqual(result.items.map(item => item.id), ['a', 'c']);
  assert.equal(result.items[1].placement?.supportId, 'a');
  assert.equal(result.items[0], shelf.items[0]);
  assert.equal(shelf.items[2].placement?.supportId, 'b');
});

test('setting the bottom book aside keeps every book and lets the rest settle', () => {
  const shelf = { ...newShelf(), items: pile() };
  const result = withoutShelfItems(shelf, ['a'], true);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].slot, null);
  assert.equal(result.items[0].placement, undefined);
  assert.equal(result.items[1].placement?.supportId, undefined);
  assert.equal(result.items[2].placement?.supportId, 'b');
});

test('copied shelf support references follow new item ids and omit missing supports', () => {
  let next = 0;
  const items = pile(), result = copyShelfItems(items, () => `new-${next++}`);
  assert.equal(result[1].placement?.supportId, 'new-0');
  assert.equal(result[2].placement?.supportId, 'new-1');
  assert.equal(items[1].placement?.supportId, 'a');
  assert.equal(copyShelfItems([items[2]], () => 'only')[0].placement?.supportId, undefined);
});
