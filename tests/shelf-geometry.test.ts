import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutShelf, type PlacedShelfObject } from '../lib/shelf-geometry';
import { findShelfSpace, materializeShelf, placeShelfItem } from '../lib/shelf-placement';
import { newBook, newShelf, type Book, type Shelf, type ShelfItem } from '../lib/types';

function book(id: string, heightMm = 210, widthMm = 135, thicknessMm = 24): Book {
  return { ...newBook(id), id, dimensions: { heightMm, widthMm, thicknessMm, source: 'manual' } };
}
function fixture(books: Book[], facing: ShelfItem['facing'] = 'spine', options: Partial<Shelf> = {}): Shelf {
  return { ...newShelf('Geometry'), ...options, items: books.map((b, slot) => ({ id: `item_${b.id}`, kind: 'book', bookId: b.id, slot, facing, pinned: false, lean: 'upright' })) };
}
function objects(shelf: Shelf, books: Book[]) { return layoutShelf(shelf, books).rows.flatMap(row => row.compartments.flatMap(part => part.items)); }
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should equal ${expected}`);
type Point = { x: number; y: number };
function corners(body: PlacedShelfObject): Point[] {
  const angle = body.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-body.width / 2, 0], [body.width / 2, 0], [body.width / 2, body.height], [-body.width / 2, body.height]].map(([x, y]) => ({
    x: body.x + body.width / 2 + x * cos + y * sin, y: body.y - x * sin + y * cos,
  }));
}
function intersects(a: Point[], b: Point[]): boolean {
  for (const shape of [a, b]) for (let i = 0; i < shape.length; i++) {
    const next = shape[(i + 1) % shape.length], axis = { x: -(next.y - shape[i].y), y: next.x - shape[i].x };
    const first = a.map(point => point.x * axis.x + point.y * axis.y), second = b.map(point => point.x * axis.x + point.y * axis.y);
    if (Math.min(Math.max(...first), Math.max(...second)) - Math.max(Math.min(...first), Math.min(...second)) <= 1e-5) return false;
  }
  return true;
}
function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function touching(a: PlacedShelfObject, b: PlacedShelfObject) {
  const first = corners(a), second = corners(b);
  return [[first, second], [second, first]].some(([points, edges]) => points.some(point => edges.some((edge, index) => distanceToSegment(point, edge, edges[(index + 1) % edges.length]) < 1e-6)));
}
function assertSafe(shelf: Shelf, books: Book[]) {
  const geometry = layoutShelf(shelf, books);
  for (const row of geometry.rows) for (const part of row.compartments) {
    for (const object of part.items) for (const point of corners(object)) {
      assert.ok(point.x >= part.x - 1e-6 && point.x <= part.x + part.width + 1e-6, 'book stays within its compartment');
      assert.ok(point.y >= -1e-6 && point.y <= geometry.rowHeightMm + 1e-6, 'book stays between the planks');
    }
    for (let i = 0; i < part.items.length; i++) for (let j = i + 1; j < part.items.length; j++) {
      assert.equal(intersects(corners(part.items[i]), corners(part.items[j])), false, `${part.items[i].itemId} intersects ${part.items[j].itemId}`);
    }
  }
  return geometry;
}

test('upright spines touch edge to edge and preserve thickness and height proportions', () => {
  const books = [book('thin', 190, 125, 12), book('thick', 240, 160, 40), book('middle', 210, 140, 24)];
  const shelf = fixture(books), placed = objects(shelf, books);
  near(placed[1].x, placed[0].x + placed[0].width);
  near(placed[2].x, placed[1].x + placed[1].width);
  near(placed[1].width / placed[0].width, 40 / 12);
  near(placed[1].height / placed[0].height, 240 / 190);
  assertSafe(shelf, books);
});

test('cover-out and horizontal orientations use the same physical measurements', () => {
  const books = [book('cover', 230, 155, 31), book('flat', 230, 155, 31)];
  const shelf = fixture(books, 'cover'); shelf.items[1].facing = 'stack';
  const placed = objects(shelf, books);
  near(placed[0].width / placed[0].height, 155 / 230);
  near(placed[1].width / placed[1].height, 230 / 31);
  near(placed[0].height, placed[1].width);
  assertSafe(shelf, books);
});

test('consecutive horizontal books form a supported pile with cumulative thickness', () => {
  const books = [book('base', 240, 160, 40), book('middle', 210, 140, 25), book('top', 180, 120, 15)];
  const shelf = fixture(books, 'stack'), placed = objects(shelf, books);
  near(placed[0].y, 0); near(placed[1].y, 40); near(placed[2].y, 65);
  near(placed[0].x + placed[0].width / 2, placed[2].x + placed[2].width / 2);
  assertSafe(shelf, books);
});

test('a leaning book contacts a shorter stack without intersecting its side profile', () => {
  for (const direction of ['left', 'right'] as const) {
    const books = direction === 'left'
      ? [book('base', 230, 155, 30), book('top', 200, 130, 20), book('lean', 235, 150, 25)]
      : [book('lean', 235, 150, 25), book('base', 230, 155, 30), book('top', 200, 130, 20)];
    const shelf = fixture(books, 'stack');
    const leanItem = shelf.items.find(item => item.bookId === 'lean')!; leanItem.facing = 'spine'; leanItem.lean = direction;
    const placed = objects(shelf, books), leaned = placed.find(item => item.itemId === leanItem.id)!;
    assert.equal(Math.sign(leaned.angle), direction === 'left' ? -1 : 1);
    assert.ok(placed.filter(item => item.itemId !== leanItem.id).some(item => touching(leaned, item)), 'lean really contacts the pile');
    assertSafe(shelf, books);
  }
});

test('wall contact keeps the lowest book corner on the plank', () => {
  const books = [book('wall', 230, 155, 25)], shelf = fixture(books); shelf.items[0].lean = 'left';
  const placed = objects(shelf, books)[0], points = corners(placed);
  assert.equal(placed.supportId, 'wall-left');
  near(Math.min(...points.map(point => point.x)), 0);
  near(Math.min(...points.map(point => point.y)), 0);
  assertSafe(shelf, books);
});

test('a bookend supports an adjacent leaning book with real edge contact', () => {
  const books = [book('lean', 230, 155, 25)], shelf = fixture(books);
  shelf.items[0].slot = 1; shelf.items[0].lean = 'left';
  shelf.items.unshift({ id: 'bookend', kind: 'decor', decor: 'bookend', slot: 0, facing: 'auto', pinned: false });
  const placed = objects(shelf, books), lean = placed.find(item => item.itemId === 'item_lean')!;
  assert.equal(lean.supportId, 'bookend');
  assert.ok(touching(lean, placed.find(item => item.itemId === 'bookend')!));
  assertSafe(shelf, books);
});

test('a requested lean stays upright when there is no reachable support', () => {
  const books = [book('alone')], shelf = fixture(books); shelf.items[0].slot = 3; shelf.items[0].lean = 'right';
  const placed = objects(shelf, books)[0];
  assert.equal(placed.angle, 0); assert.equal(placed.supportId, undefined);
  assertSafe(shelf, books);
});

test('crowded cubbies scale each compartment uniformly and never cross a divider', () => {
  const books = [book('large', 500, 400, 150), book('small', 250, 200, 75), book('third', 310, 210, 60)];
  const shelf = fixture(books, 'cover', { bookcase: 'cubby' });
  const geometry = assertSafe(shelf, books), first = geometry.rows[0].compartments[0];
  assert.ok(first.scale < 1); assert.equal(geometry.scaled, true);
  near(first.items[0].width / first.items[1].width, 2); near(first.items[0].height / first.items[1].height, 2);
  assert.ok(geometry.rows[0].compartments[1].items[0].x >= geometry.rows[0].compartments[1].x);
});

test('intentional empty slots separate groups, staged books remain absent, and placement does not mutate state', () => {
  const books = [book('a'), book('b'), book('staged')], shelf = fixture(books);
  shelf.items[1].slot = 5; shelf.items[2].slot = null; shelf.items[0].pinned = true;
  const snapshot = JSON.stringify(shelf), placed = objects(shelf, books);
  assert.equal(placed.length, 2); assert.ok(placed[1].x - placed[0].x - placed[0].width > 50);
  assert.equal(JSON.stringify(shelf), snapshot); assert.deepEqual(objects(shelf, books), placed);
  assertSafe(shelf, books);
});

test('mixed sizes, requested leans, piles, and all bookcases retain nonintersecting bounded geometry', () => {
  for (const bookcase of ['open', 'cubby', 'tower'] as const) for (let variation = 0; variation < 18; variation++) {
    const books = Array.from({ length: bookcase === 'tower' ? 4 : bookcase === 'cubby' ? 6 : 8 }, (_, index) =>
      book(`b${index}`, 120 + (index * 71 + variation * 29) % 380, 70 + (index * 37 + variation * 19) % 280, 4 + (index * 23 + variation * 11) % 140));
    const shelf = fixture(books, 'spine', { bookcase });
    shelf.items.forEach((item, index) => {
      item.facing = (['spine', 'stack', 'stack', 'cover'] as const)[(index + variation) % 4];
      item.lean = (['auto', 'left', 'right', 'upright'] as const)[(index * 3 + variation) % 4];
    });
    assertSafe(shelf, books);
  }
});

test('migrating an old arrangement keeps its continuous gaps, rows, and stack order', () => {
  const books = [book('a'), book('b'), book('base'), book('top')], shelf = fixture(books);
  shelf.items[1].slot = 5;
  shelf.items[2].slot = 8; shelf.items[2].facing = 'stack';
  shelf.items[3].slot = 9; shelf.items[3].facing = 'stack';
  const before = objects(shelf, books), migrated = materializeShelf(shelf, books), after = objects(migrated, books);
  assert.equal(migrated.items[3].placement?.supportId, 'item_base');
  assert.equal(migrated.items[3].placement?.row, 1);
  for (const prior of before) {
    const current = after.find(item => item.itemId === prior.itemId)!;
    near(current.x, prior.x); near(current.y, prior.y); near(current.width, prior.width);
  }
  assertSafe(migrated, books);
});

test('a free drop follows an arbitrary coordinate and manually lifts a formerly pinned item', () => {
  const books = [book('free')], shelf = fixture(books); shelf.items[0].pinned = true;
  const snapshot = JSON.stringify(shelf);
  const result = placeShelfItem(shelf, books, 'item_free', { row: 2, x: .634, y: 90, mode: 'spine' });
  assert.equal(result.valid, true); assert.equal(result.object?.row, 2);
  near((result.object!.bounds.x + result.object!.bounds.width / 2) / 840, .634);
  near(result.object!.bounds.y, 0);
  assert.equal(result.shelf.items[0].pinned, false);
  assert.equal(JSON.stringify(shelf), snapshot);
  assert.deepEqual(result.geometry, layoutShelf(result.shelf, books), 'ghost and committed rendering are the same calculation');
});

test('a gallery row accepts more than four books based on their actual widths', () => {
  const books = Array.from({ length: 12 }, (_, i) => book(`free${i}`, 210, 135, 24));
  let shelf = fixture(books, 'spine', { layout: 'gallery' });
  shelf.items = shelf.items.map(item => ({ ...item, slot: null }));
  for (const item of shelf.items) {
    const result = findShelfSpace(shelf, books, item.id);
    assert.equal(result.valid, true); shelf = result.shelf;
  }
  assert.equal(objects(shelf, books).filter(item => item.row === 0).length, 12);
  assert.equal(new Set(shelf.items.map(item => item.slot)).size, 12);
  assertSafe(shelf, books);
});

test('dropping between books makes room without swapping or losing the neighbors', () => {
  const books = ['a', 'b', 'c', 'moving'].map(id => book(id, 210, 135, 30));
  const shelf = fixture(books);
  shelf.items.forEach((item, i) => { item.placement = { row: i === 3 ? 1 : 0, x: i === 3 ? .6 : (250 + i * 30) / 840 }; });
  const result = placeShelfItem(shelf, books, 'item_moving', { row: 0, x: 267 / 840, y: 0, mode: 'spine' });
  assert.equal(result.valid, true); assert.equal(objects(result.shelf, books).length, 4);
  const ordered = objects(result.shelf, books).sort((a, b) => a.x - b.x).map(item => item.itemId);
  assert.deepEqual(ordered, ['item_a', 'item_moving', 'item_b', 'item_c']);
  assertSafe(result.shelf, books);
  assert.deepEqual(result.geometry, layoutShelf(result.shelf, books));
});

test('hovering over a horizontal pile infers a real stack and keeps the drop preview exact', () => {
  const books = [book('base', 240, 150, 30), book('moving', 210, 140, 20)], shelf = fixture(books, 'stack');
  shelf.items[0].placement = { row: 0, x: .4 }; shelf.items[1].slot = null;
  const result = placeShelfItem(shelf, books, 'item_moving', { row: 0, x: .4, y: 60, mode: 'auto' });
  assert.equal(result.valid, true); assert.equal(result.object?.facing, 'stack');
  assert.equal(result.object?.supportId, 'item_base'); near(result.object!.bounds.y, 30);
  assert.equal(result.shelf.items[1].placement?.supportId, 'item_base');
  assert.deepEqual(result.geometry, layoutShelf(result.shelf, books));
  assertSafe(result.shelf, books);
});

test('lifting a bottom or middle book settles the remaining pile on its old row', () => {
  const books = [book('base', 240, 150, 30), book('middle', 210, 140, 20), book('top', 180, 120, 15)];
  for (const moved of ['base', 'middle']) {
    const shelf = fixture(books, 'stack');
    const result = placeShelfItem(shelf, books, `item_${moved}`, { row: 1, x: .65, y: 0, mode: 'stack' });
    assert.equal(result.valid, true);
    const placed = objects(result.shelf, books), remaining = placed.filter(item => item.row === 0).sort((a, b) => a.y - b.y);
    assert.equal(remaining.length, 2); near(remaining[0].bounds.y, 0); near(remaining[1].bounds.y, remaining[0].height);
    assert.equal(result.shelf.items.find(item => item.id === remaining[0].itemId)?.placement?.supportId, undefined);
    assert.equal(result.shelf.items.find(item => item.id === remaining[1].itemId)?.placement?.supportId, remaining[0].itemId);
    assertSafe(result.shelf, books);
  }
});

test('free leaning meets walls and shorter piles without intersection or hovering', () => {
  const books = [book('base', 230, 150, 30), book('top', 200, 130, 20), book('lean', 235, 150, 25)];
  const shelf = fixture(books, 'stack');
  shelf.items[0].placement = { row: 0, x: .35 };
  shelf.items[1].placement = { row: 0, x: .35, supportId: 'item_base' };
  shelf.items[2].slot = null;
  const result = placeShelfItem(shelf, books, 'item_lean', { row: 0, x: (840 * .35 + 115 + 32) / 840, y: 0, mode: 'lean-left' });
  assert.equal(result.valid, true); assert.ok(result.object!.angle < 0);
  assert.ok(objects(result.shelf, books).filter(object => object.itemId !== 'item_lean').some(object => touching(object, result.object!)));
  assert.equal(result.shelf.items[2].placement?.supportId, undefined, 'a side lean does not become a vertical pile link');
  assertSafe(result.shelf, books);
  for (const [x, mode, wall] of [[0, 'lean-left', 'wall-left'], [1, 'lean-right', 'wall-right']] as const) {
    const wallShelf = fixture([books[2]]);
    const atWall = placeShelfItem(wallShelf, [books[2]], 'item_lean', { row: 0, x, y: 0, mode });
    assert.equal(atWall.valid, true); assert.equal(atWall.object!.supportId, wall);
    assertSafe(atWall.shelf, [books[2]]);
  }
});

test('a physically full row produces a blocked preview instead of silently replacing a book', () => {
  const books = Array.from({ length: 7 }, (_, i) => book(`cover${i}`, 210, 135, 24)), shelf = fixture(books, 'cover');
  shelf.items.forEach((item, i) => { item.placement = { row: i === 6 ? 1 : 0, x: (75 + i * 135) / 840 }; });
  const snapshot = JSON.stringify(shelf), result = placeShelfItem(shelf, books, 'item_cover6', { row: 0, x: .6, y: 0, mode: 'cover' });
  assert.equal(result.valid, false); assert.ok(result.object); assert.equal(objects(result.shelf, books).length, 7);
  assert.equal(JSON.stringify(shelf), snapshot);
  assert.match(result.hint, /room/i);
  assertSafe(result.shelf, books);
});

test('free coordinates stay bounded and collision-free in every bookcase with mixed dimensions', () => {
  for (const bookcase of ['open', 'cubby', 'tower'] as const) for (let variation = 0; variation < 12; variation++) {
    const books = Array.from({ length: 9 }, (_, index) => book(`free${index}`, 120 + (index * 31 + variation * 13) % 260, 70 + (index * 17 + variation * 9) % 180, 5 + (index * 11 + variation * 7) % 50));
    const shelf = fixture(books, 'spine', { bookcase });
    shelf.items.forEach((item, index) => {
      item.placement = { row: index % 3, x: ((index * 17 + variation * 11) % 101) / 100 };
      item.facing = (['spine', 'stack', 'cover'] as const)[(index + variation) % 3];
      item.lean = (['auto', 'left', 'right', 'upright'] as const)[(index * 3 + variation) % 4];
    });
    assertSafe(shelf, books);
  }
});
