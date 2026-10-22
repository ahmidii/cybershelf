import { bookDimensions } from './book-size';
import { shelfGrid, type Book, type PublicBook, type Shelf, type ShelfItem } from './types';

export type BookFacing = 'spine' | 'cover' | 'stack';
export interface ShelfBounds { x: number; y: number; width: number; height: number; }
export interface PlacedShelfObject {
  itemId: string; slot: number; facing: BookFacing | 'decor';
  /** Body coordinates before CSS rotation; y is measured up from the plank. */
  x: number; y: number; width: number; height: number; angle: number;
  bounds: ShelfBounds; supportId?: string;
}
export interface ShelfCompartment {
  index: number; startSlot: number; slotCount: number;
  x: number; width: number; scale: number; items: PlacedShelfObject[];
}
export interface ShelfGeometry {
  widthMm: number; rowHeightMm: number; columns: number; scaled: boolean;
  rows: { index: number; compartments: ShelfCompartment[] }[];
}

type VisibleBook = Book | PublicBook;
type Piece = { item: ShelfItem; facing: BookFacing | 'decor'; x: number; y: number; width: number; height: number };
type Unit = { pieces: Piece[]; width: number; height: number; support: boolean; angle: number; reach: number; supportId?: string; locked: boolean };
type Group = { first: number; last: number; units: Unit[]; width: number };
const radians = (degrees: number) => Math.abs(degrees) * Math.PI / 180;
const epsilon = 1e-7;

export function facingForItem(item: ShelfItem, shelf: Pick<Shelf, 'layout'>): BookFacing {
  if (item.facing !== 'auto') return item.facing;
  return shelf.layout === 'gallery' ? 'cover' : shelf.layout === 'stacks' ? 'stack' : 'spine';
}

function decorSize(item: ShelfItem): { width: number; height: number } {
  const sizes = { plant: [120, 185], bear: [120, 145], robot: [100, 150], vase: [88, 165], bookend: [48, 105], image: [130, 170] };
  const [width, height] = sizes[item.decor ?? 'image'];
  return { width, height };
}

function buildUnits(items: ShelfItem[], shelf: Shelf, books: Map<string, VisibleBook>, rowHeight: number): Unit[] {
  const units: Unit[] = [];
  for (const item of items) {
    const book = item.kind === 'book' ? books.get(item.bookId ?? '') : undefined;
    const facing = book ? facingForItem(item, shelf) : 'decor';
    const dimensions = book ? bookDimensions(book) : undefined;
    const size = dimensions
      ? { width: facing === 'cover' ? dimensions.widthMm : facing === 'stack' ? dimensions.heightMm : dimensions.thicknessMm,
          height: facing === 'stack' ? dimensions.thicknessMm : dimensions.heightMm }
      : item.kind === 'decor' ? decorSize(item) : { width: 62, height: 145 };
    const previous = units.at(-1);
    // A continuous run of horizontal books becomes a real pile. Start another
    // pile before it reaches the shelf above, keeping every book retrievable.
    if (facing === 'stack' && previous?.pieces[0].facing === 'stack' && previous.height + size.height <= rowHeight * .86) {
      previous.pieces.push({ item, facing, x: 0, y: previous.height, ...size });
      previous.height += size.height;
      previous.width = Math.max(previous.width, size.width);
      for (const piece of previous.pieces) piece.x = (previous.width - piece.width) / 2;
    } else {
      units.push({ pieces: [{ item, facing, x: 0, y: 0, ...size }], ...size, support: !!book || item.decor === 'bookend', angle: 0, reach: 0, locked: false });
    }
  }
  return units;
}

/** Horizontal space needed at the foot of a leaning book. Each horizontal
 * book contributes its actual side profile, so a lean can meet a short pile
 * at its top corner without cutting through the pile below it. */
function supportReach(support: Unit, side: 'left' | 'right', angle: number, bookHeight: number): number | null {
  if (!support.support || support.angle !== 0) return null;
  const theta = radians(angle), top = bookHeight * Math.cos(theta);
  let reach = -Infinity;
  for (const piece of support.pieces) {
    if (piece.y >= top) continue;
    const inset = side === 'left' ? support.width - piece.x - piece.width : piece.x;
    reach = Math.max(reach, Math.min(piece.y + piece.height, top) * Math.tan(theta) - inset);
  }
  if (!Number.isFinite(reach) || reach <= 0) return null;
  const overhang = bookHeight * Math.sin(theta) - reach;
  // Never let the upper part reach beyond the supporting object into another
  // group. A book with no reachable support simply remains upright.
  return overhang > support.width + epsilon ? null : reach;
}

function settleGroup(group: Group, wallLeft: boolean, wallRight: boolean, allowAuto: boolean, spaceBefore: boolean, spaceAfter: boolean) {
  const units = group.units;
  let automaticIndex = -1, automaticDirection: 'left' | 'right' = 'left';
  if (allowAuto) {
    const tail = units.at(-1)!;
    if (tail.pieces[0].facing === 'spine' && !tail.pieces[0].item.pinned && (tail.pieces[0].item.lean ?? 'auto') === 'auto') {
      if (units.length > 1 && units[units.length - 2].support && spaceAfter) automaticIndex = units.length - 1;
      else if (units.length === 1 && wallLeft) automaticIndex = 0;
      else if (units.length === 1 && wallRight) { automaticIndex = 0; automaticDirection = 'right'; }
    }
    const head = units[0];
    if (automaticIndex === -1 && units.length > 1 && head.pieces[0].facing === 'spine' && !head.pieces[0].item.pinned &&
        (head.pieces[0].item.lean ?? 'auto') === 'auto' && units[1].support && (spaceBefore || units[1].pieces[0].facing === 'stack')) {
      automaticIndex = 0; automaticDirection = 'right';
    }
  }
  units.forEach((unit, index) => {
    const piece = unit.pieces[0], preference = piece.item.lean ?? 'auto';
    if (unit.locked || piece.facing !== 'spine' || preference === 'upright') return;
    const direction = preference === 'left' || preference === 'right' ? preference : index === automaticIndex ? automaticDirection : null;
    if (!direction) return;
    const angle = (direction === 'left' ? -1 : 1) * (preference === 'auto' ? 7 : 10);
    const neighbor = units[index + (direction === 'left' ? -1 : 1)];
    const wall = direction === 'left' ? index === 0 && wallLeft : index === units.length - 1 && wallRight;
    const neighborPreference = neighbor?.pieces[0].item.lean ?? 'auto';
    // A support must stay upright. Resolve conflicting requests consistently;
    // do not create a pair of books apparently floating against each other.
    if (direction === 'right' && neighbor && neighbor.pieces[0].facing === 'spine' && ['left', 'right'].includes(neighborPreference)) return;
    const reach = neighbor ? supportReach(neighbor, direction, angle, piece.height) : wall ? piece.height * Math.sin(radians(angle)) : null;
    if (reach === null) return;
    unit.angle = angle; unit.reach = reach;
    unit.supportId = neighbor ? neighbor.pieces.at(-1)!.item.id : direction === 'left' ? 'wall-left' : 'wall-right';
    if (neighbor && direction === 'right') neighbor.locked = true;
  });
  group.width = units.reduce((total, unit) => total + (unit.angle ? unit.pieces[0].width * Math.cos(radians(unit.angle)) + unit.reach : unit.width), 0);
}

function compartment(index: number, startSlot: number, slotCount: number, x: number, width: number, rowHeight: number,
  shelf: Shelf, bySlot: Map<number, ShelfItem>, books: Map<string, VisibleBook>): ShelfCompartment {
  const groups: Group[] = [];
  for (let position = 0; position < slotCount; position++) {
    const item = bySlot.get(startSlot + position);
    if (!item) continue;
    const items = [item]; const first = position;
    while (position + 1 < slotCount && bySlot.has(startSlot + position + 1)) items.push(bySlot.get(startSlot + ++position)!);
    const units = buildUnits(items, shelf, books, rowHeight);
    groups.push({ first, last: position, units, width: units.reduce((total, unit) => total + unit.width, 0) });
  }
  if (!groups.length) return { index, startSlot, slotCount, x, width, scale: 1, items: [] };
  const gapCount = slotCount - groups.reduce((count, group) => count + group.last - group.first + 1, 0);
  const naturalWidth = groups.reduce((total, group) => total + group.width, 0);
  const allowAuto = naturalWidth < width * .88;
  groups.forEach((group, n) => settleGroup(group, n === 0 && group.first === 0,
    n === groups.length - 1 && group.last === slotCount - 1 && gapCount > 0, allowAuto,
    group.first > (n ? groups[n - 1].last + 1 : 0), group.last < slotCount - 1 || gapCount === 0));
  const contentWidth = groups.reduce((total, group) => total + group.width, 0);
  const tallest = Math.max(...groups.flatMap(group => group.units.map(unit => unit.angle
    ? unit.height * Math.cos(radians(unit.angle)) + unit.width * Math.sin(radians(unit.angle)) : unit.height)));
  const minimumAir = Math.min(gapCount * 12, width * .16);
  const scale = Math.min(1, (width - minimumAir) / contentWidth, (rowHeight - 12) / tallest);
  const free = Math.max(0, width - contentWidth * scale);
  const airUnit = gapCount ? free / gapCount : 0;
  const placed: PlacedShelfObject[] = [];
  let cursor = x, priorLast = -1;
  for (const group of groups) {
    cursor += (group.first - priorLast - 1) * airUnit;
    for (const unit of group.units) {
      const theta = radians(unit.angle), cosine = Math.cos(theta), sine = Math.sin(theta);
      const overhang = unit.angle ? unit.height * sine - unit.reach : 0;
      for (const piece of unit.pieces) {
        const boundsX = cursor + (unit.angle < 0 ? -overhang : piece.x) * scale;
        const boundsWidth = (unit.angle ? piece.width * cosine + piece.height * sine : piece.width) * scale;
        const boundsHeight = (unit.angle ? piece.height * cosine + piece.width * sine : piece.height) * scale;
        const rotationOffset = unit.angle ? (piece.width * cosine - piece.width) / 2 + (unit.angle < 0 ? piece.height * sine : 0) : 0;
        placed.push({ itemId: piece.item.id, slot: piece.item.slot!, facing: piece.facing,
          x: boundsX + rotationOffset * scale, y: (piece.y + (unit.angle ? piece.width / 2 * sine : 0)) * scale,
          width: piece.width * scale, height: piece.height * scale, angle: unit.angle,
          bounds: { x: boundsX, y: piece.y * scale, width: boundsWidth, height: boundsHeight },
          ...(unit.supportId ? { supportId: unit.supportId } : {}),
        });
      }
      cursor += (unit.angle ? unit.width * cosine + unit.reach : unit.width) * scale;
    }
    priorLast = group.last;
  }
  return { index, startSlot, slotCount, x, width, scale, items: placed };
}

/** Deterministic, constrained settling. Slots retain their existing order and
 * grouping; bodies use millimetre proportions instead of equal-width cells.
 * Only a whole compartment is scaled when it cannot fit at the nominal size. */
export function layoutShelf(shelf: Shelf, books: VisibleBook[]): ShelfGeometry {
  const grid = shelfGrid(shelf);
  const widthMm = shelf.bookcase === 'tower' ? 430 : 840, rowHeightMm = 280;
  const partitions = shelf.bookcase === 'cubby' ? 3 : 1, divider = 12;
  const compartmentWidth = (widthMm - (partitions - 1) * divider) / partitions;
  const slotCount = grid.columns / partitions;
  const bySlot = new Map(shelf.items.filter(item => item.slot !== null).map(item => [item.slot!, item]));
  const bookMap = new Map(books.map(book => [book.id, book]));
  const rows = Array.from({ length: grid.rows }, (_, row) => ({ index: row,
    compartments: Array.from({ length: partitions }, (_, part) => compartment(part, row * grid.columns + part * slotCount,
      slotCount, part * (compartmentWidth + divider), compartmentWidth, rowHeightMm, shelf, bySlot, bookMap)),
  }));
  return { widthMm, rowHeightMm, columns: grid.columns, rows, scaled: rows.some(row => row.compartments.some(part => part.scale < .999)) };
}
