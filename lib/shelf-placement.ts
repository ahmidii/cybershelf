import { facingForItem, layoutShelf, materializeShelf, shelfItemSize, shelfMeasurements, type PlacedShelfObject, type ShelfGeometry } from './shelf-geometry';
import type { Book, PublicBook, Shelf, ShelfItem } from './types';

export { materializeShelf } from './shelf-geometry';
export type PlacementMode = 'auto' | 'spine' | 'cover' | 'stack' | 'lean-left' | 'lean-right';
export interface ShelfPlacementTarget { row: number; x: number; y: number; mode?: PlacementMode; }
export interface ShelfPlacementResult {
  shelf: Shelf; geometry: ShelfGeometry; object?: PlacedShelfObject; valid: boolean; hint: string;
}
type VisibleBook = Book | PublicBook;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const flat = (geometry: ShelfGeometry) => geometry.rows.flatMap(row => row.compartments.flatMap(part => part.items));
const cloneItem = (item: ShelfItem): ShelfItem => ({ ...item, ...(item.placement ? { placement: { ...item.placement } } : {}) });

/** Save the solver's actual settled centers, so removing a neighbor later does
 * not spring the rest of a collection back to an old pointer destination. */
function rememberGeometry(shelf: Shelf, geometry: ShelfGeometry): Shelf {
  const byId = new Map(flat(geometry).map(object => [object.itemId, object]));
  return { ...shelf, items: shelf.items.map(item => {
    const object = byId.get(item.id);
    if (!object || item.slot === null) { const next = cloneItem(item); if (item.slot === null) delete next.placement; return next; }
    return { ...item, placement: {
      row: object.row, x: clamp((object.anchorX ?? object.bounds.x + object.bounds.width / 2) / geometry.widthMm, 0, 1),
      ...(object.bounds.y > .001 && object.supportId && byId.has(object.supportId) ? { supportId: object.supportId } : {}),
    } };
  }) };
}

/** Lift only this object. The books above it settle onto its former support,
 * keeping their original row and horizontal position rather than following it. */
function liftedShelf(shelf: Shelf, itemId: string): Shelf {
  const source = shelf.items.find(item => item.id === itemId);
  return { ...shelf, items: shelf.items.map(item => {
    const next = cloneItem(item);
    if (item.id === itemId) { next.slot = null; delete next.placement; }
    else if (next.placement?.supportId === itemId) {
      if (source?.placement?.supportId) next.placement.supportId = source.placement.supportId;
      else delete next.placement.supportId;
    }
    return next;
  }) };
}

function nextSlot(shelf: Shelf, preferred: number | null): number | undefined {
  const used = new Set(shelf.items.filter(item => item.slot !== null).map(item => item.slot));
  if (preferred !== null && preferred >= 0 && preferred <= 1000 && !used.has(preferred)) return preferred;
  for (let slot = 0; slot <= 1000; slot++) if (!used.has(slot)) return slot;
}

/** One pure operation powers the pointer ghost, keyboard moves, and the final
 * drop. Pointer coordinates express intent; this function supplies gravity,
 * contacts, stacking, and the minimum neighboring movement needed to fit. */
export function placeShelfItem(shelf: Shelf, books: VisibleBook[], itemId: string, target: ShelfPlacementTarget): ShelfPlacementResult {
  const originalGeometry = layoutShelf(shelf, books), source = shelf.items.find(item => item.id === itemId);
  const invalid = (hint: string): ShelfPlacementResult => ({ shelf, geometry: originalGeometry, valid: false, hint });
  const measurements = shelfMeasurements(shelf);
  if (!source) return invalid('Choose a book or decoration first.');
  if (!Number.isInteger(target.row) || target.row < 0 || target.row >= measurements.rows || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return invalid('Bring it over a shelf to place it.');
  const initial = materializeShelf(shelf, books);
  let lifted = liftedShelf(initial, itemId);
  lifted = rememberGeometry(lifted, layoutShelf(lifted, books));
  const baseGeometry = layoutShelf(lifted, books);
  const row = baseGeometry.rows[target.row];
  const requestedX = clamp(target.x, 0, 1) * measurements.widthMm;
  const part = row.compartments.reduce((best, current) => {
    const distance = (p: typeof current) => Math.max(p.x - requestedX, requestedX - p.x - p.width, 0);
    return distance(current) < distance(best) ? current : best;
  });
  const slot = nextSlot(lifted, source.slot);
  if (slot === undefined) return invalid('This shelf has reached its item limit.');
  const mode = target.mode ?? 'auto';
  const moving: ShelfItem = { ...source, slot, pinned: false, placement: { row: target.row, x: clamp(target.x, 0, 1) } };
  if (source.kind === 'book') {
    moving.facing = mode === 'auto' ? facingForItem(source, shelf) : mode === 'lean-left' || mode === 'lean-right' ? 'spine' : mode;
    moving.lean = mode === 'lean-left' ? 'left' : mode === 'lean-right' ? 'right' : mode === 'auto' ? 'auto' : 'upright';
  }
  const hasChildren = new Set(lifted.items.map(item => item.placement?.supportId).filter(Boolean));
  // A pile offers one supported top surface. A toy on top of it does not turn
  // into a pretend horizontal surface for another book.
  const pile = (mode === 'auto' || mode === 'stack') ? part.items.filter(object => object.facing === 'stack' && !hasChildren.has(object.itemId) &&
    requestedX >= object.bounds.x - 18 && requestedX <= object.bounds.x + object.bounds.width + 18 &&
    (mode === 'stack' || target.y >= object.bounds.y + object.bounds.height - 18))
    .sort((a, b) => (b.bounds.y + b.bounds.height) - (a.bounds.y + a.bounds.height))[0] : undefined;
  let pileTooTall = false;
  if (pile) {
    if (moving.kind === 'book') { moving.facing = 'stack'; moving.lean = 'upright'; }
    const size = shelfItemSize(moving, shelf, books);
    const center = clamp(requestedX, pile.bounds.x + pile.bounds.width * .3, pile.bounds.x + pile.bounds.width * .7);
    moving.placement = { row: target.row, x: center / measurements.widthMm, supportId: pile.itemId };
    pileTooTall = pile.bounds.y + pile.bounds.height + size.height * part.scale > measurements.rowHeightMm - 8;
  } else {
    const size = shelfItemSize(moving, shelf, books);
    const theta = (mode === 'lean-left' || mode === 'lean-right') ? 10 * Math.PI / 180 : 0;
    const footprint = (theta ? size.width * Math.cos(theta) + size.height * Math.sin(theta) : size.width) * part.scale;
    const half = Math.min(part.width, footprint) / 2;
    let center = clamp(requestedX, part.x + half, part.x + part.width - half);
    const magneticCenters = [part.x + half, part.x + part.width - half];
    for (const object of part.items.filter(object => object.bounds.y < .001)) {
      magneticCenters.push(object.bounds.x - half, object.bounds.x + object.bounds.width + half);
    }
    const nearest = magneticCenters.filter(x => x >= part.x + half - .001 && x <= part.x + part.width - half + .001 &&
      part.items.every(object => x + half <= object.bounds.x + .001 || x - half >= object.bounds.x + object.bounds.width - .001))
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))[0];
    if (nearest !== undefined && Math.abs(nearest - center) <= 13 * part.scale) center = nearest;
    moving.placement!.x = center / measurements.widthMm;
  }
  let candidate = { ...lifted, items: lifted.items.map(item => item.id === itemId ? moving : item) };
  let geometry = layoutShelf(candidate, books);
  const crowded = geometry.rows[target.row].compartments[part.index].overfull === true;
  candidate = rememberGeometry(candidate, geometry);
  geometry = layoutShelf(candidate, books);
  const object = flat(geometry).find(object => object.itemId === itemId);
  if (!object) return invalid('There is no room for this item here.');
  const support = object.supportId ? books.find(book => book.id === candidate.items.find(item => item.id === object.supportId)?.bookId) : undefined;
  const hint = pileTooTall ? 'That pile has reached the shelf above. Try beside it.'
    : crowded ? 'A little more room is needed here. Try another shelf or turn the book.'
    : object.bounds.y > .001 && object.angle === 0 ? support ? `Stack on ${support.title}` : 'Settle on this stack'
    : object.angle ? object.supportId?.startsWith('wall-') ? 'Lean against the shelf wall' : support ? `Lean against ${support.title}` : 'Lean against this support'
    : mode === 'lean-left' || mode === 'lean-right' ? 'Upright here — bring it closer to a support to lean'
    : object.facing === 'cover' ? 'Cover facing out' : object.facing === 'stack' ? 'Start a stack here' : moving.kind === 'decor' ? 'A little personality, right here' : 'Spines settle together';
  return { shelf: candidate, geometry, object, valid: !crowded && !pileTooTall, hint };
}

/** Find real physical space when adding from the library. Horizontal books can
 * join a nearby pile; otherwise try the open space on each shelf in order. */
export function findShelfSpace(shelf: Shelf, books: VisibleBook[], itemId: string): ShelfPlacementResult {
  const source = shelf.items.find(item => item.id === itemId);
  const measures = shelfMeasurements(shelf), geometry = layoutShelf(shelf, books);
  if (!source) return { shelf, geometry, valid: false, hint: 'Choose a book or decoration first.' };
  const facing = source.kind === 'book' ? facingForItem(source, shelf) : 'decor';
  const size = shelfItemSize(source, shelf, books);
  for (const row of geometry.rows) for (const part of row.compartments) {
    if (facing === 'stack') for (const pile of part.items.filter(item => item.facing === 'stack').sort((a, b) => b.bounds.y - a.bounds.y)) {
      const result = placeShelfItem(shelf, books, itemId, { row: row.index, x: (pile.bounds.x + pile.bounds.width / 2) / measures.widthMm, y: pile.bounds.y + pile.bounds.height, mode: 'stack' });
      if (result.valid) return result;
    }
    const half = size.width * part.scale / 2;
    const candidates = [part.x + half, ...part.items.filter(item => item.bounds.y < .001).map(item => item.bounds.x + item.bounds.width + half)];
    for (const center of candidates.filter(center => center + half <= part.x + part.width + .001)) {
      const result = placeShelfItem(shelf, books, itemId, { row: row.index, x: center / measures.widthMm, y: 0, mode: source.kind === 'book' ? facing as PlacementMode : 'auto' });
      if (result.valid) return result;
    }
  }
  return { shelf, geometry, valid: false, hint: 'This shelf is full. Keep it beside the shelf or try another bookcase.' };
}
