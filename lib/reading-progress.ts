import type { Book } from './types';

export interface ReadingPositionInput {
  mode: 'page' | 'percent';
  marker: string;
  totalPages?: string;
}

export interface ReadingPosition {
  progress: number;
  page?: number;
  pages?: number;
}

export const MAX_BOOK_PAGES = 100000;

export function validPageCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_BOOK_PAGES;
}

export function bookReadingProgress(book: Pick<Book, 'progress' | 'status'>): number {
  return book.status === 'read' ? 100 : Number.isFinite(book.progress) ? Math.min(100, Math.max(0, book.progress)) : 0;
}

/** Rounding is for display only. The stored fraction remains the spoiler ceiling. */
export function displayReadingProgress(value: number): number {
  const progress = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return progress < 100 ? Math.min(99.9, Math.round(progress * 10) / 10) : 100;
}

function explicitPage(book: Pick<Book, 'pages' | 'progress' | 'status' | 'currentPage'>): number | undefined {
  if (!validPageCount(book.pages) || !Number.isInteger(book.currentPage) || book.currentPage! < 0 || book.currentPage! > book.pages) return undefined;
  return Math.abs(book.currentPage! / book.pages * 100 - bookReadingProgress(book)) < 1e-8 ? book.currentPage : undefined;
}

/** Prefer an exact saved page. A percent-only import never invents a later page. */
export function currentReadingPage(book: Pick<Book, 'pages' | 'progress' | 'status' | 'currentPage'>): number | undefined {
  if (!validPageCount(book.pages)) return undefined;
  return explicitPage(book) ?? Math.min(book.pages, Math.floor(book.pages * bookReadingProgress(book) / 100 + 1e-9));
}

export function readingInputPages(book: Pick<Book, 'pages'>, totalPages?: string): number | undefined {
  if (validPageCount(book.pages)) return book.pages;
  const entered = totalPages?.trim() ? Number(totalPages) : undefined;
  return validPageCount(entered) ? entered : undefined;
}

export function resolveReadingPosition(book: Pick<Book, 'pages'>, input: ReadingPositionInput): ReadingPosition {
  const marker = Number(input.marker);
  if (!input.marker.trim() || !Number.isFinite(marker)) throw new Error('Add the page or percentage you have reached.');
  if (input.mode === 'percent') {
    if (marker < 0 || marker > 100) throw new Error('Reading progress must be between 0 and 100%.');
    return { progress: marker };
  }
  if (!Number.isInteger(marker) || marker < 0 || marker > MAX_BOOK_PAGES) throw new Error('Choose a page between 0 and 100,000.');
  const pages = readingInputPages(book, input.totalPages);
  if (!pages) throw new Error(input.totalPages?.trim()
    ? 'Total pages must be a whole number between 1 and 100,000.'
    : 'Add your edition’s total pages once. We’ll calculate the percentage for you.');
  if (marker > pages) throw new Error(`Choose a page between 0 and ${pages.toLocaleString()}, or correct this edition’s total pages in Book details.`);
  return { progress: marker / pages * 100, page: marker, pages };
}

/** Changing an edition total reconciles only a known, exact bookmark.
 * A different edition or an incompatible total keeps the old fraction instead
 * of clamping a page to the end and accidentally marking the book finished. */
export function pageCountPatch(book: Book, total?: number): Partial<Book> {
  const pages = validPageCount(total) ? total : undefined;
  const page = explicitPage(book);
  if (pages === book.pages) return { pages };
  if (page === undefined || !pages || page > pages) return { pages, currentPage: undefined };
  const progress = page / pages * 100;
  return {
    pages, currentPage: page, progress,
    ...(book.status === 'read' && progress < 100 ? { status: 'reading', finishedAt: undefined } : {}),
  };
}

export function readingPositionPatch(book: Book, position: ReadingPosition, finishedAt = new Date().toISOString()): Partial<Book> {
  const complete = position.progress === 100;
  const total = position.pages ?? book.pages;
  const candidate = position.page ?? (position.progress === bookReadingProgress(book) ? explicitPage(book) : undefined);
  // A note-only update can retain a legacy percentage with an inferred page.
  // Never label that approximation as an exact page bookmark.
  const page = validPageCount(total) && candidate !== undefined && Number.isInteger(candidate) && candidate >= 0 && candidate <= total && Math.abs(candidate / total * 100 - position.progress) < 1e-8 ? candidate : undefined;
  return {
    progress: position.progress,
    currentPage: page,
    ...(position.pages ? { pages: position.pages, ...(book.dimensions?.source === 'estimated' && position.pages !== book.pages ? { dimensions: undefined } : {}) } : {}),
    status: complete ? 'read' : book.status === 'unread' || book.status === 'read' ? 'reading' : book.status,
    ...(complete ? { finishedAt: book.finishedAt ?? finishedAt } : book.status === 'read' ? { finishedAt: undefined } : {}),
  };
}
