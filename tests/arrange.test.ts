import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeShelf } from '../lib/arrange';
import { createDemoState } from '../lib/demo';
import { resizeShelf, shelfCapacity } from '../lib/types';

test('automatic arrangement preserves pinned books, decorations, intentional gaps, and unplaced items', () => {
  const state = createDemoState(), shelf = state.shelves[0];
  const pinned = shelf.items.find(item => item.kind === 'book')!; pinned.pinned = true;
  const staged = { ...shelf.items.find(item => item.kind === 'book')!, id: 'unplaced_copy', pinned: false, slot: null };
  shelf.items.push(staged);
  const beforeSlots = shelf.items.filter(item => item.slot !== null).map(item => item.slot).sort((a, b) => a! - b!);
  const output = arrangeShelf(shelf, state.books, 'title');
  assert.equal(output.items.find(item => item.id === pinned.id)?.slot, pinned.slot);
  assert.equal(output.items.find(item => item.id === staged.id)?.slot, null);
  assert.deepEqual(output.items.filter(item => item.kind === 'decor'), shelf.items.filter(item => item.kind === 'decor'));
  assert.deepEqual(output.items.filter(item => item.slot !== null).map(item => item.slot).sort((a, b) => a! - b!), beforeSlots);
  assert.notEqual(output, shelf);
  assert.equal(output.items.length, shelf.items.length);
});

test('title order is stable and natural while original state remains unchanged', () => {
  const state = createDemoState(), shelf = state.shelves[0];
  const original = JSON.stringify(shelf);
  const sorted = arrangeShelf(shelf, state.books, 'title');
  const bookMap = new Map(state.books.map(book => [book.id, book]));
  const names = sorted.items.filter(item => item.kind === 'book').sort((a, b) => a.slot! - b.slot!).map(item => bookMap.get(item.bookId!)!.title);
  assert.deepEqual(names, [...names].sort(new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare));
  assert.equal(JSON.stringify(shelf), original);
});

test('a smaller layout stages overflow without deleting placements and sorting leaves it staged', () => {
  const state = createDemoState();
  const resized = resizeShelf(state.shelves[0], { layout: 'gallery' });
  const stagedIds = resized.items.filter(item => item.slot === null).map(item => item.id);
  assert.ok(stagedIds.length > 0);
  assert.equal(resized.items.length, state.shelves[0].items.length);
  assert.ok(resized.items.every(item => item.slot === null || item.slot < shelfCapacity(resized)));
  assert.deepEqual(arrangeShelf(resized, state.books, 'color').items.filter(item => item.slot === null).map(item => item.id), stagedIds);
});
