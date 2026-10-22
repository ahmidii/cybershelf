import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutShelf, type PlacedShelfObject } from '../lib/shelf-geometry';
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
