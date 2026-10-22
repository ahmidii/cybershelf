import type { Book, BookDimensions, BookFormat } from './types';

export const BOOK_FORMATS: { id: BookFormat; name: string }[] = [
  { id: 'paperback', name: 'Paperback' },
  { id: 'hardcover', name: 'Hardcover' },
  { id: 'pocket', name: 'Pocket paperback' },
  { id: 'large', name: 'Large format' },
];

export const DIMENSION_LIMITS = {
  heightMm: { min: 100, max: 500 },
  widthMm: { min: 60, max: 400 },
  thicknessMm: { min: 2, max: 150 },
} as const;

const formats: Record<BookFormat, { height: number; width: number; leaf: number; binding: number }> = {
  paperback: { height: 203, width: 133, leaf: .104, binding: 2 },
  hardcover: { height: 235, width: 156, leaf: .112, binding: 5 },
  pocket: { height: 178, width: 108, leaf: .09, binding: 2 },
  large: { height: 275, width: 210, leaf: .13, binding: 4 },
};
const tenth = (value: number) => Math.round(value * 10) / 10;

export function validBookDimensions(value: unknown): value is BookDimensions {
  if (!value || typeof value !== 'object') return false;
  const dimensions = value as Record<string, unknown>;
  return ['estimated', 'catalog', 'manual'].includes(String(dimensions.source)) &&
    (Object.keys(DIMENSION_LIMITS) as (keyof typeof DIMENSION_LIMITS)[]).every(key => {
      const number = dimensions[key], limit = DIMENSION_LIMITS[key];
      return typeof number === 'number' && Number.isFinite(number) && number >= limit.min && number <= limit.max;
    });
}

/** Display estimates, not manufacturing specifications. A page is half a leaf;
 * format supplies a typical trim and paper stock until an edition size is known. */
export function bookDimensions(book: Pick<Book, 'pages' | 'format' | 'dimensions'>): BookDimensions {
  if (validBookDimensions(book.dimensions)) return { ...book.dimensions };
  const format = formats[book.format ?? 'paperback'] ?? formats.paperback;
  const pages = Number.isFinite(book.pages) && (book.pages ?? 0) > 0 ? Math.min(book.pages!, 100000) : 320;
  return {
    heightMm: format.height,
    widthMm: format.width,
    thicknessMm: tenth(Math.min(150, Math.max(2, Math.ceil(pages / 2) * format.leaf + format.binding))),
    source: 'estimated',
  };
}

export function normalizeBookISBN(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const isbn = value.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(isbn)) {
    const total = [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
    return total % 10 === 0 ? isbn : undefined;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const total = [...isbn].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
    return total % 11 === 0 ? isbn : undefined;
  }
  return undefined;
}

function editionISBN(value: unknown): string | undefined {
  const isbn = normalizeBookISBN(value);
  if (!isbn || isbn.length === 13) return isbn;
  const prefix = '978' + isbn.slice(0, 9);
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return prefix + String((10 - sum % 10) % 10);
}

export function catalogBookFormat(value: unknown): BookFormat | undefined {
  if (typeof value !== 'string') return undefined;
  if (/mass[ -]?market|pocket/i.test(value)) return 'pocket';
  if (/hard(?:cover|back)|cloth|library binding/i.test(value)) return 'hardcover';
  if (/paperback|soft(?:cover|back)/i.test(value)) return 'paperback';
  return undefined;
}

const unitScale = (unit: string) => /^(?:mm|millimet)/i.test(unit) ? 1 : /^(?:cm|centimet)/i.test(unit) ? 10 : 25.4;
const unitPattern = '(?:millimet(?:er|re)s?|centimet(?:er|re)s?|inches|inch|mm|cm|in\\.?)';
const numberPattern = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';

/** Open Library stores free text, not a guaranteed H/W/T tuple. Labelled axes
 * can be catalog values. A plausible unlabelled H×W×T tuple remains an estimate;
 * incomplete or ambiguous text is never promoted to a measured book size. */
export function parseCatalogDimensions(value: unknown): BookDimensions | undefined {
  if (typeof value !== 'string' || value.length > 300) return undefined;
  const normalized = value.trim().toLowerCase().replaceAll('×', 'x');
  const labelled = new RegExp(`\\b(height|width|thickness|depth)\\s*[:=]?\\s*(${numberPattern})\\s*(${unitPattern})\\b`, 'g');
  const explicit: Partial<BookDimensions> = {};
  const seen = new Set<string>();
  for (const match of normalized.matchAll(labelled)) {
    const key = match[1] === 'height' ? 'heightMm' : match[1] === 'width' ? 'widthMm' : 'thicknessMm';
    if (seen.has(key)) return undefined;
    seen.add(key); explicit[key] = tenth(Number(match[2]) * unitScale(match[3]));
  }
  if (seen.size === 3) {
    const result = { ...explicit, source: 'catalog' };
    return validBookDimensions(result) ? result : undefined;
  }
  const tuple = new RegExp(`^(${numberPattern})\\s*x\\s*(${numberPattern})\\s*x\\s*(${numberPattern})\\s*(${unitPattern})\\s*(?:\\(([^)]+)\\))?\\.?$`).exec(normalized);
  if (!tuple) return undefined;
  const values = tuple.slice(1, 4).map(number => tenth(Number(number) * unitScale(tuple[4])));
  const order = tuple[5]?.replaceAll('height', 'h').replaceAll('width', 'w').replace(/thickness|depth/g, 'd').replace(/[\s.]/g, '');
  let result: BookDimensions;
  if (order) {
    const axes = order.split('x');
    if (axes.length !== 3 || new Set(axes).size !== 3 || !axes.every(axis => ['h', 'w', 'd'].includes(axis))) return undefined;
    result = { heightMm: values[axes.indexOf('h')], widthMm: values[axes.indexOf('w')], thicknessMm: values[axes.indexOf('d')], source: 'catalog' };
  } else {
    if (values[0] < values[1] || values[2] >= Math.min(values[0], values[1])) return undefined;
    result = { heightMm: values[0], widthMm: values[1], thicknessMm: values[2], source: 'estimated' };
  }
  return validBookDimensions(result) ? result : undefined;
}

export interface EditionAppearance {
  isbn: string; pages?: number; format?: BookFormat; dimensions?: BookDimensions;
  coverUrl?: string; sourceUrl: string;
}

/** A caller supplies an exact ISBN; unrelated or incomplete provider records
 * cannot silently replace a reader's selected edition. */
export function editionAppearance(value: unknown, requestedISBN: string): EditionAppearance | undefined {
  const isbn = normalizeBookISBN(requestedISBN);
  if (!isbn || !value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const identifiers = [data.isbn_10, data.isbn_13].flatMap(value => Array.isArray(value) ? value : []);
  if (!identifiers.some(value => editionISBN(value) === editionISBN(isbn))) return undefined;
  const result: EditionAppearance = { isbn, sourceUrl: `https://openlibrary.org/isbn/${isbn}` };
  const pages = data.number_of_pages;
  if (typeof pages === 'number' && Number.isInteger(pages) && pages > 0 && pages <= 100000) result.pages = pages;
  const format = catalogBookFormat(data.physical_format);
  if (format) result.format = format;
  const dimensions = parseCatalogDimensions(data.physical_dimensions);
  if (dimensions) result.dimensions = dimensions;
  const cover = Array.isArray(data.covers) ? data.covers.find(id => typeof id === 'number' && Number.isInteger(id) && id > 0) : undefined;
  if (cover) result.coverUrl = `https://covers.openlibrary.org/b/id/${cover}-M.jpg`;
  return result;
}
