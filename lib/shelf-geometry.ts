import { bookDimensions } from './book-size';
import { shelfGrid, type Book, type PublicBook, type Shelf, type ShelfItem } from './types';

export type BookFacing = 'spine' | 'cover' | 'stack';
export interface ShelfBounds { x: number; y: number; width: number; height: number; }
export interface PlacedShelfObject {
  itemId: string; slot: number; row: number; facing: BookFacing | 'decor';
  /** Body coordinates before CSS rotation; y is measured up from the plank. */
  x: number; y: number; width: number; height: number; angle: number;
  bounds: ShelfBounds; supportId?: string;
  /** The settled group center; stored separately from a leaning silhouette. */
  anchorX?: number;
}
export interface ShelfCompartment {
  index: number; startSlot: number; slotCount: number;
  x: number; width: number; scale: number; items: PlacedShelfObject[]; overfull?: boolean;
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

export function decorSize(item: ShelfItem): { width: number; height: number } {
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
        placed.push({ itemId: piece.item.id, slot: piece.item.slot!, row: Math.floor(piece.item.slot! / shelfGrid(shelf).columns), facing: piece.facing,
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
export function layoutLegacyShelf(shelf: Shelf, books: VisibleBook[]): ShelfGeometry {
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

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function shelfMeasurements(shelf: Pick<Shelf, 'bookcase' | 'layout'>) {
  const grid = shelfGrid(shelf);
  const widthMm = shelf.bookcase === 'tower' ? 430 : 840;
  const partitions = shelf.bookcase === 'cubby' ? 3 : 1;
  const compartmentWidth = (widthMm - (partitions - 1) * 12) / partitions;
  return { ...grid, widthMm, rowHeightMm: 280, partitions, compartmentWidth };
}

export function shelfItemSize(item: ShelfItem, shelf: Shelf, books: VisibleBook[]) {
  const book = item.kind === 'book' ? books.find(book => book.id === item.bookId) : undefined;
  const facing = book ? facingForItem(item, shelf) : 'decor';
  if (!book) return { ...(item.kind === 'decor' ? decorSize(item) : { width: 62, height: 145 }), facing };
  const size = bookDimensions(book);
  return {
    width: facing === 'cover' ? size.widthMm : facing === 'stack' ? size.heightMm : size.thicknessMm,
    height: facing === 'stack' ? size.thicknessMm : size.heightMm,
    facing,
  };
}

/** Read the old arrangements once, as geometry rather than numbered targets.
 * This also recovers the existing horizontal piles as explicit support chains.
 * Already migrated objects retain their continuous coordinates. */
export function materializeShelf(shelf: Shelf, books: VisibleBook[]): Shelf {
  if (shelf.items.every(item => item.slot === null || item.placement)) return shelf;
  const legacy = layoutLegacyShelf(shelf, books);
  const objects = legacy.rows.flatMap(row => row.compartments.flatMap(part => part.items));
  const byId = new Map(objects.map(object => [object.itemId, object]));
  const geometry = shelfMeasurements(shelf);
  const items = shelf.items.map(item => {
    if (item.slot === null || item.placement) return { ...item, ...(item.placement ? { placement: { ...item.placement } } : {}) };
    const object = byId.get(item.id);
    if (!object) {
      // Old files can contain more indexed entries than the former grid. Keep
      // them visible, and let ordinary packing fit the last row safely.
      return { ...item, placement: { row: Math.min(geometry.rows - 1, Math.floor(item.slot / geometry.columns)), x: ((item.slot % geometry.columns) + .5) / geometry.columns } };
    }
    const support = object.facing === 'stack' && object.bounds.y > epsilon
      ? objects.find(candidate => candidate.row === object.row && candidate.itemId !== object.itemId && candidate.facing === 'stack' &&
        Math.abs(candidate.bounds.y + candidate.bounds.height - object.bounds.y) < .001 &&
        candidate.bounds.x < object.bounds.x + object.bounds.width && candidate.bounds.x + candidate.bounds.width > object.bounds.x)
      : undefined;
    return { ...item, placement: { row: object.row, x: clamp((object.bounds.x + object.bounds.width / 2) / geometry.widthMm, 0, 1), ...(support ? { supportId: support.itemId } : {}) } };
  });
  return { ...shelf, items };
}

interface FreePiece { item: ShelfItem; facing: BookFacing | 'decor'; x: number; y: number; width: number; height: number; supportId?: string; }
interface FreeUnit { id: string; pieces: FreePiece[]; desired: number; x: number; width: number; height: number; reserve: number; }
type Point = { x: number; y: number };

export function shelfObjectCorners(body: PlacedShelfObject): Point[] {
  const angle = body.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-body.width / 2, 0], [body.width / 2, 0], [body.width / 2, body.height], [-body.width / 2, body.height]].map(([x, y]) => ({
    x: body.x + body.width / 2 + x * cos + y * sin, y: body.y - x * sin + y * cos,
  }));
}

export function shelfObjectsOverlap(first: PlacedShelfObject, second: PlacedShelfObject): boolean {
  const a = shelfObjectCorners(first), b = shelfObjectCorners(second);
  for (const shape of [a, b]) for (let i = 0; i < shape.length; i++) {
    const next = shape[(i + 1) % shape.length], axis = { x: -(next.y - shape[i].y), y: next.x - shape[i].x };
    const p = a.map(point => point.x * axis.x + point.y * axis.y), q = b.map(point => point.x * axis.x + point.y * axis.y);
    if (Math.min(Math.max(...p), Math.max(...q)) - Math.max(Math.min(...p), Math.min(...q)) <= .00001) return false;
  }
  return true;
}

function groupFreeItems(items: ShelfItem[], shelf: Shelf, books: VisibleBook[], widthMm: number): FreeUnit[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const parent = new Map<string, string>();
  for (const item of items) {
    const support = byId.get(item.placement?.supportId ?? '');
    if (!support || support.id === item.id || support.kind !== 'book' || facingForItem(support, shelf) !== 'stack') continue;
    const visited = new Set([item.id]); let cursor: ShelfItem | undefined = support;
    while (cursor && !visited.has(cursor.id)) { visited.add(cursor.id); cursor = byId.get(cursor.placement?.supportId ?? ''); }
    if (!cursor) parent.set(item.id, support.id);
  }
  const children = new Map<string, ShelfItem[]>();
  for (const item of items) { const id = parent.get(item.id); if (id) children.set(id, [...(children.get(id) ?? []), item]); }
  const units: FreeUnit[] = [];
  for (const root of items.filter(item => !parent.has(item.id))) {
    const order: ShelfItem[] = [];
    const visit = (item: ShelfItem) => { order.push(item); for (const child of children.get(item.id) ?? []) visit(child); };
    visit(root);
    const desired = root.placement!.x * widthMm;
    const pieces: FreePiece[] = [];
    let top = 0;
    for (const item of order) {
      const size = shelfItemSize(item, shelf, books), previous = pieces.at(-1);
      const preferred = (item.placement!.x - root.placement!.x) * widthMm;
      const center = previous ? clamp(preferred, previous.x + previous.width * .25, previous.x + previous.width * .75) : 0;
      pieces.push({ item, ...size, facing: size.facing as BookFacing | 'decor', x: center - size.width / 2, y: top, ...(previous ? { supportId: previous.item.id } : {}) });
      top += size.height;
    }
    const minimum = Math.min(...pieces.map(piece => piece.x));
    const maximum = Math.max(...pieces.map(piece => piece.x + piece.width));
    const physicalWidth = maximum - minimum;
    const explicitLean = pieces.length === 1 && pieces[0].facing === 'spine' && (root.lean === 'left' || root.lean === 'right');
    const reserve = explicitLean ? Math.max(0, pieces[0].width * Math.cos(radians(10)) + pieces[0].height * Math.sin(radians(10)) - physicalWidth) : 0;
    for (const piece of pieces) piece.x -= minimum - reserve / 2;
    units.push({ id: root.id, pieces, desired: desired + (minimum + maximum) / 2, x: 0, width: physicalWidth + reserve, height: top, reserve });
  }
  return units.sort((a, b) => a.desired - b.desired || items.findIndex(item => item.id === a.id) - items.findIndex(item => item.id === b.id));
}

function leaningPose(body: PlacedShelfObject, angle: number, left: number): PlacedShelfObject {
  const theta = radians(angle), cos = Math.cos(theta), sin = Math.sin(theta);
  return { ...body, angle,
    x: left + (body.width * cos - body.width) / 2 + (angle < 0 ? body.height * sin : 0),
    y: body.width / 2 * sin,
    bounds: { x: left, y: 0, width: body.width * cos + body.height * sin, height: body.height * cos + body.width * sin },
  };
}

function leanFreeObjects(objects: PlacedShelfObject[], units: FreeUnit[], part: ShelfCompartment, rowHeight: number, shelf: Shelf, scale: number) {
  const byId = new Map(shelf.items.map(item => [item.id, item]));
  const unitFor = (id: string) => units.find(unit => unit.pieces.some(piece => piece.item.id === id));
  const stable = new Set<string>();
  for (let i = 0; i < objects.length; i++) {
    const body = objects[i], item = byId.get(body.itemId)!, unit = unitFor(body.itemId)!;
    if (body.facing !== 'spine' || body.bounds.y > epsilon || unit.pieces.length !== 1 || stable.has(body.itemId) || item.lean === 'upright') continue;
    const explicit = item.lean === 'left' || item.lean === 'right';
    const maximum = explicit ? 10 : 7;
    const rootIndex = units.indexOf(unit);
    const candidates: { direction: 'left' | 'right'; distance: number; support: FreeUnit | undefined }[] = [];
    for (const direction of ['left', 'right'] as const) {
      if (explicit && item.lean !== direction) continue;
      const neighbor = units[rootIndex + (direction === 'left' ? -1 : 1)];
      const neighborBodies = neighbor ? objects.filter(object => neighbor.pieces.some(piece => piece.item.id === object.itemId)) : [];
      const validSupport = !neighbor || neighborBodies.every(object => object.angle === 0) && neighbor.pieces.some(piece => piece.item.kind === 'book' || piece.item.decor === 'bookend');
      if (!validSupport) continue;
      const edge = neighbor ? direction === 'left' ? Math.max(...neighborBodies.map(object => object.bounds.x + object.bounds.width)) : Math.min(...neighborBodies.map(object => object.bounds.x)) : direction === 'left' ? part.x : part.x + part.width;
      const gap = direction === 'left' ? body.bounds.x - edge : edge - body.bounds.x - body.bounds.width;
      if (gap > (explicit ? 80 : 46) * scale) continue;
      candidates.push({ direction, distance: Math.max(0, gap), support: neighbor });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let accepted = false;
    for (const candidate of candidates) {
      for (let degrees = maximum; degrees >= 2; degrees--) {
        const angle = degrees * (candidate.direction === 'left' ? -1 : 1), theta = radians(angle);
        const cosine = Math.cos(theta), sine = Math.sin(theta);
        let left: number, supportId: string;
        const supports = candidate.support ? objects.filter(object => candidate.support!.pieces.some(piece => piece.item.id === object.itemId)) : [];
        if (!supports.length) {
          left = candidate.direction === 'left' ? part.x : part.x + part.width - body.width * cosine - body.height * sine;
          supportId = candidate.direction === 'left' ? 'wall-left' : 'wall-right';
        } else {
          const edge = candidate.direction === 'left' ? Math.max(...supports.map(object => object.bounds.x + object.bounds.width)) : Math.min(...supports.map(object => object.bounds.x));
          let reach = -Infinity, contact = supports[0];
          for (const support of supports) {
            if (support.bounds.y >= body.height * cosine) continue;
            const inset = candidate.direction === 'left' ? edge - support.bounds.x - support.bounds.width : support.bounds.x - edge;
            const value = Math.min(support.bounds.y + support.bounds.height, body.height * cosine) * Math.tan(theta) - inset;
            if (value > reach) { reach = value; contact = support; }
          }
          if (!Number.isFinite(reach) || reach <= 0) continue;
          left = candidate.direction === 'left' ? edge + reach - body.height * sine : edge - reach - body.width * cosine;
          supportId = contact.itemId;
        }
        const proposed = { ...leaningPose(body, angle, left), supportId };
        const movement = Math.abs((proposed.bounds.x + proposed.bounds.width / 2) - (body.bounds.x + body.bounds.width / 2));
        if (movement > 85 * scale || shelfObjectCorners(proposed).some(point => point.x < part.x - epsilon || point.x > part.x + part.width + epsilon || point.y < -epsilon || point.y > rowHeight + epsilon)) continue;
        if (objects.some(other => other.itemId !== body.itemId && shelfObjectsOverlap(proposed, other))) continue;
        objects[i] = proposed;
        for (const support of supports) stable.add(support.itemId);
        accepted = true; break;
      }
      if (accepted) break;
    }
  }
}

function layoutFreeCompartment(shelf: Shelf, books: VisibleBook[], row: number, partIndex: number, members: ShelfItem[]): ShelfCompartment {
  const measures = shelfMeasurements(shelf), x = partIndex * (measures.compartmentWidth + 12), width = measures.compartmentWidth;
  const result: ShelfCompartment = { index: partIndex, startSlot: row * measures.columns + partIndex * measures.columns / measures.partitions,
    slotCount: measures.columns / measures.partitions, x, width, scale: 1, items: [] };
  if (!members.length) return result;
  const units = groupFreeItems(members, shelf, books, measures.widthMm);
  const height = Math.max(...units.map(unit => unit.height + (unit.reserve ? unit.pieces[0].width * Math.sin(radians(10)) : 0)));
  const heightScale = Math.min(1, (measures.rowHeightMm - 8) / height);
  const needed = units.reduce((total, unit) => total + unit.width, 0);
  result.overfull = needed * heightScale > width + .001;
  const scale = Math.min(heightScale, width / needed); result.scale = scale;
  // The forward/backward projection moves only the neighbors needed to make
  // room, preserving order and deliberate gaps wherever space permits.
  let edge = x;
  for (const unit of units) { unit.x = Math.max(edge, clamp(unit.desired - unit.width * scale / 2, x, x + width - unit.width * scale)); edge = unit.x + unit.width * scale; }
  edge = x + width;
  for (let i = units.length - 1; i >= 0; i--) { units[i].x = Math.min(units[i].x, edge - units[i].width * scale); edge = units[i].x; }
  for (const unit of units) for (const piece of unit.pieces) {
    const pieceX = unit.x + piece.x * scale, y = piece.y * scale, pieceWidth = piece.width * scale, pieceHeight = piece.height * scale;
    result.items.push({ itemId: piece.item.id, slot: piece.item.slot!, row, facing: piece.facing, x: pieceX, y,
      width: pieceWidth, height: pieceHeight, angle: 0,
      anchorX: unit.reserve ? unit.x + unit.width * scale / 2 : pieceX + pieceWidth / 2,
      bounds: { x: pieceX, y, width: pieceWidth, height: pieceHeight }, ...(piece.supportId ? { supportId: piece.supportId } : {}) });
  }
  leanFreeObjects(result.items, units, result, measures.rowHeightMm, shelf, scale);
  return result;
}

/** Continuous coordinates are independent of the former presentation grid.
 * Shelves without coordinates still render through their exact legacy layout
 * until their first direct manipulation. */
export function layoutShelf(shelf: Shelf, books: VisibleBook[]): ShelfGeometry {
  if (!shelf.items.some(item => item.slot !== null && item.placement)) return layoutLegacyShelf(shelf, books);
  const materialized = materializeShelf(shelf, books), measures = shelfMeasurements(shelf);
  const placed = materialized.items.filter(item => item.slot !== null && item.placement);
  const rows = Array.from({ length: measures.rows }, (_, row) => ({ index: row,
    compartments: Array.from({ length: measures.partitions }, (_, part) => layoutFreeCompartment(materialized, books, row, part,
      placed.filter(item => clamp(Math.floor(item.placement!.row), 0, measures.rows - 1) === row &&
        clamp(Math.floor(item.placement!.x * measures.widthMm / (measures.compartmentWidth + 12)), 0, measures.partitions - 1) === part))),
  }));
  return { widthMm: measures.widthMm, rowHeightMm: measures.rowHeightMm, columns: measures.columns, rows,
    scaled: rows.some(row => row.compartments.some(part => part.scale < .999)) };
}
