import type { AppState, Book, ReadingLogEntry } from './types';
import { bookReadingProgress, displayReadingProgress, readingPositionPatch, resolveReadingPosition, type ReadingPositionInput } from './reading-progress';

export const READING_LOG_LIMIT = 200;
export const READING_THOUGHT_LIMIT = 4000;

export function makeReadingEntry(
  book: Pick<Book, 'pages' | 'progress'> & Partial<Pick<Book, 'status'>>,
  input: ReadingPositionInput & { body: string },
  identity: { id: string; createdAt: string },
  preserveBookmark = false,
): ReadingLogEntry {
  if (input.body.length > READING_THOUGHT_LIMIT) throw new Error('Keep a reading thought to 4,000 characters.');
  const position = resolveReadingPosition(book, input);
  const progress = preserveBookmark ? bookReadingProgress({ progress: book.progress, status: book.status ?? 'reading' }) : position.progress;
  return { ...identity, body: input.body.trim(), progress, ...(position.page === undefined ? {} : { page: position.page }) };
}

/** Entries retain their own progress and time when the book moves forward.
 * A reading update never copies a private review or notes into the entry. */
export function appendReadingEntry(state: AppState, bookId: string, entry: ReadingLogEntry, pages?: number): AppState {
  const book = state.books.find(book => book.id === bookId);
  if (!book) throw new Error('This book is no longer in your library.');
  if ((book.readingLog?.length ?? 0) >= READING_LOG_LIMIT) throw new Error('This book has 200 reading updates. Export a backup, then remove an older update to make room.');
  if (state.books.some(book => book.readingLog?.some(previous => previous.id === entry.id))) throw new Error('That reading update has already been saved.');
  return {
    ...state,
    books: state.books.map(current => current.id !== bookId ? current : {
      ...current,
      ...readingPositionPatch(current, { progress: entry.progress, page: entry.page, pages }, entry.createdAt),
      readingLog: [...(current.readingLog ?? []), { ...entry }],
    }),
  };
}

export function readingMarker(entry: Pick<ReadingLogEntry, 'page' | 'progress'>): string {
  const progress = displayReadingProgress(entry.progress);
  return entry.page !== undefined ? `Page ${entry.page.toLocaleString()} · ${progress}%` : `${progress}% read`;
}
