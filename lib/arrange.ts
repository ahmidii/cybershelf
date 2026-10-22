import type { Book, Shelf } from './types';

export type Arrangement = 'title' | 'author' | 'color';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function colorKey(hex: string): [number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) return [2, 0, 0];
  const channels = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels;
  const high = Math.max(...channels), low = Math.min(...channels), delta = high - low;
  const lightness = (high + low) / 2;
  if (delta < .08) return [1, 0, -lightness];
  let hue = high === r ? ((g - b) / delta) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return [0, hue, -lightness];
}

/** Reorders only the book positions that are already occupied. Gaps, pins,
 * decorations, and the Not placed yet tray remain exactly where they were. */
export function arrangeShelf(shelf: Shelf, books: Book[], mode: Arrangement): Shelf {
  const lookup = new Map(books.map(book => [book.id, book]));
  const movable = shelf.items.filter(item => item.kind === 'book' && !item.pinned && item.slot !== null && lookup.has(item.bookId ?? ''));
  const slots = movable.map(item => item.slot!).sort((a, b) => a - b);
  const ordered = [...movable].sort((a, b) => {
    const left = lookup.get(a.bookId!)!, right = lookup.get(b.bookId!)!;
    if (mode === 'color') {
      const l = colorKey(left.color), r = colorKey(right.color);
      for (let n = 0; n < l.length; n++) if (Math.abs(l[n] - r[n]) > .00001) return l[n] - r[n];
    }
    if (mode === 'author') {
      const authorOrder = collator.compare(left.author, right.author);
      if (authorOrder) return authorOrder;
    }
    return collator.compare(left.title, right.title) || (a.slot! - b.slot!);
  });
  const assignment = new Map(ordered.map((item, index) => [item.id, slots[index]]));
  return { ...shelf, items: shelf.items.map(item => assignment.has(item.id) ? { ...item, slot: assignment.get(item.id)! } : { ...item }) };
}
