import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeShelf } from '../lib/arrange';
import { createDemoState } from '../lib/demo';
import { newBook, newShelf, resizeShelf, shelfPlacementError, type ShelfItem } from '../lib/types';

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

test('changing display layout preserves every visible legacy item with continuous coordinates', () => {
  const state = createDemoState();
  const resized = resizeShelf(state.shelves[0], { layout: 'gallery' });
  const stagedIds = resized.items.filter(item => item.slot === null).map(item => item.id);
  assert.deepEqual(stagedIds, state.shelves[0].items.filter(item=>item.slot===null).map(item=>item.id));
  assert.equal(resized.items.length, state.shelves[0].items.length);
  assert.ok(resized.items.every(item => item.slot === null || item.placement && item.placement.row < 3));
  assert.deepEqual(arrangeShelf(resized, state.books, 'color').items.filter(item => item.slot === null).map(item => item.id), stagedIds);
});

test('continuous sorting preserves stack roles and remaps support references to the books taking those roles', () => {
  const books=['Zebra','Beta','Alpha'].map(title=>newBook(title));
  const items:ShelfItem[]=[
    {id:'bottom',kind:'book',bookId:books[0].id,slot:40,pinned:false,facing:'stack',placement:{row:0,x:.25}},
    {id:'top',kind:'book',bookId:books[1].id,slot:41,pinned:false,facing:'stack',placement:{row:0,x:.25,supportId:'bottom'}},
    {id:'upright',kind:'book',bookId:books[2].id,slot:42,pinned:false,facing:'spine',lean:'left',placement:{row:0,x:.7}},
    {id:'plant',kind:'decor',decor:'plant',slot:43,pinned:false,facing:'auto',placement:{row:0,x:.9}},
    {id:'tray',kind:'book',bookId:books[0].id,slot:null,pinned:false,facing:'cover'},
  ];
  const shelf={...newShelf(),items},original=JSON.stringify(shelf);
  const sorted=arrangeShelf(shelf,books,'title'),byId=new Map(sorted.items.map(item=>[item.id,item]));
  assert.equal(byId.get('upright')!.slot,40);
  assert.equal(byId.get('upright')!.facing,'stack');
  assert.equal(byId.get('upright')!.lean,undefined);
  assert.equal(byId.get('top')!.placement!.supportId,'upright');
  assert.equal(byId.get('bottom')!.slot,42);
  assert.equal(byId.get('bottom')!.facing,'spine');
  assert.equal(byId.get('bottom')!.lean,'left');
  assert.deepEqual(byId.get('plant'),items[3]);
  assert.deepEqual(byId.get('tray'),items[4]);
  assert.equal(shelfPlacementError(sorted),null);
  assert.equal(JSON.stringify(shelf),original);
});

test('changing bookcase preserves free placement identifiers and clamps whole stacks onto a remaining row', () => {
  const shelf={...newShelf(),bookcase:'tower' as const,items:[
    {id:'base',kind:'book' as const,bookId:'book1',slot:100,pinned:false,facing:'stack' as const,placement:{row:3,x:.36}},
    {id:'top',kind:'book' as const,bookId:'book2',slot:101,pinned:false,facing:'stack' as const,placement:{row:3,x:.36,supportId:'base'}},
  ]};
  const resized=resizeShelf(shelf,{bookcase:'open',layout:'gallery'});
  assert.deepEqual(resized.items.map(item=>item.slot),[100,101]);
  assert.deepEqual(resized.items.map(item=>item.placement?.row),[2,2]);
  assert.deepEqual(resized.items.map(item=>item.placement?.x),[.36,.36]);
  assert.equal(resized.items[1].placement?.supportId,'base');
  assert.equal(shelfPlacementError(resized),null);
  assert.equal(shelf.items[0].placement.row,3);
});
