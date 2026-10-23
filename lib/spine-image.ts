import { normalizeBookISBN } from './book-size';
import type { Book } from './types';

export const SPINE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const SPINE_PHOTO_MAX_PIXELS = 40_000_000;
export const SPINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validSpineImage(value: string): boolean {
  if (!value) return true;
  if (/^\/api\/assets\/[A-Za-z0-9_-]{1,100}$/.test(value) || /^\/api\/(?:publications|profiles|journal)\/[A-Za-z0-9_-]{1,100}\/assets\/[A-Za-z0-9_-]{1,100}$/.test(value)) return true;
  if (value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function canonicalISBN(value: unknown): string | undefined {
  const isbn = normalizeBookISBN(value);
  if (!isbn || isbn.length === 13) return isbn;
  const prefix = '978' + isbn.slice(0, 9);
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return prefix + String((10 - sum % 10) % 10);
}

type EditionIdentity = Pick<Book, 'catalogId' | 'editionId' | 'isbn'>;

/** A photo belongs to a specific copy. Adding its first identifier is safe;
 * explicitly replacing an existing match must not carry the old spine over. */
export function spineEditionChanged(previous: EditionIdentity, next: EditionIdentity): boolean {
  const previousISBN = canonicalISBN(previous.isbn), nextISBN = canonicalISBN(next.isbn);
  if (previousISBN && nextISBN && previousISBN !== nextISBN) return true;
  if (previous.editionId && next.editionId && previous.editionId !== next.editionId) return true;
  return !!(previous.catalogId && next.catalogId && previous.catalogId !== next.catalogId);
}

/** Captured before asynchronous image work so an upload cannot land on a
 * different copy after a reader switches books or changes edition. */
export function spineCopyIdentity(book: Pick<Book, 'id'> & EditionIdentity): string {
  return [book.id, canonicalISBN(book.isbn) ?? '', book.editionId ?? '', book.catalogId ?? ''].join('|');
}

export const clampSpineRatio = (value: number) => Math.min(.5, Math.max(.025, Number.isFinite(value) ? value : .12));

export interface SpineCropGeometry {
  scale: number;
  offsetX: number;
  offsetY: number;
  maxOffsetX: number;
  maxOffsetY: number;
  rotation: number;
}

/** Keep every pixel in the crop covered by the rotated photograph. The same
 * transform drives the live preview and the exported image. */
export function spineCropGeometry(input: {
  imageWidth: number; imageHeight: number; frameWidth: number; frameHeight: number;
  turns: number; zoom: number; offsetX: number; offsetY: number;
}): SpineCropGeometry {
  const { imageWidth, imageHeight, frameWidth, frameHeight } = input;
  if (![imageWidth, imageHeight, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('Choose a photo with readable dimensions.');
  const turns = ((Math.round(Number.isFinite(input.turns) ? input.turns : 0) % 4) + 4) % 4;
  const rotatedWidth = turns % 2 ? imageHeight : imageWidth;
  const rotatedHeight = turns % 2 ? imageWidth : imageHeight;
  const zoom = Math.max(1, Math.min(6, Number.isFinite(input.zoom) ? input.zoom : 1));
  const scale = Math.max(frameWidth / rotatedWidth, frameHeight / rotatedHeight) * zoom;
  const maxOffsetX = Math.max(0, (rotatedWidth * scale - frameWidth) / 2);
  const maxOffsetY = Math.max(0, (rotatedHeight * scale - frameHeight) / 2);
  return {
    scale, maxOffsetX, maxOffsetY, rotation: turns * 90,
    offsetX: Math.max(-maxOffsetX, Math.min(maxOffsetX, Number.isFinite(input.offsetX) ? input.offsetX : 0)),
    offsetY: Math.max(-maxOffsetY, Math.min(maxOffsetY, Number.isFinite(input.offsetY) ? input.offsetY : 0)),
  };
}
