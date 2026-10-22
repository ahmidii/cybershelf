import type { AppState, Book, ReadingLogEntry } from './types';

export const READING_LOG_LIMIT = 200;
export const READING_THOUGHT_LIMIT = 4000;

export function makeReadingEntry(
  book: Pick<Book, 'pages' | 'progress'>,
  input: { mode: 'percent' | 'page'; marker: string; body: string; progress?: string },
  identity: { id: string; createdAt: string },
): ReadingLogEntry {
  const marker = Number(input.marker);
  if (!input.marker.trim() || !Number.isFinite(marker)) throw new Error('Add the page or percentage you have reached.');
  if (input.body.length > READING_THOUGHT_LIMIT) throw new Error('Keep a reading thought to 4,000 characters.');
  if (input.mode === 'page') {
    const maximum = book.pages && book.pages > 0 ? book.pages : 100000;
    if (!Number.isInteger(marker) || marker < 0 || marker > maximum) throw new Error(`Choose a page between 0 and ${maximum.toLocaleString()}. You can change the edition’s page count in Book details.`);
  } else if (marker < 0 || marker > 100) throw new Error('Reading progress must be between 0 and 100%.');
  const manualProgress = input.progress === undefined ? book.progress : Number(input.progress);
  if (input.mode === 'page' && !book.pages && (input.progress?.trim() === '' || !Number.isFinite(manualProgress) || manualProgress < 0 || manualProgress > 100)) throw new Error('Add a percentage between 0 and 100% for this entry.');
  const progress = input.mode === 'page'
    ? book.pages && book.pages > 0 ? Math.round(marker / book.pages * 1000) / 10 : Math.round(manualProgress * 10) / 10
    : Math.round(marker * 10) / 10;
  return { ...identity, body: input.body.trim(), progress, ...(input.mode === 'page' ? { page: marker } : {}) };
}

/** Entries retain their own progress and time when the book moves forward.
 * A reading update never copies a private review or notes into the entry. */
export function appendReadingEntry(state: AppState, bookId: string, entry: ReadingLogEntry): AppState {
  const book = state.books.find(book => book.id === bookId);
  if (!book) throw new Error('This book is no longer in your library.');
  if ((book.readingLog?.length ?? 0) >= READING_LOG_LIMIT) throw new Error('This book has 200 reading updates. Export a backup, then remove an older update to make room.');
  if (state.books.some(book => book.readingLog?.some(previous => previous.id === entry.id))) throw new Error('That reading update has already been saved.');
  const completed = entry.progress === 100;
  return {
    ...state,
    books: state.books.map(current => current.id !== bookId ? current : {
      ...current,
      progress: entry.progress,
      status: completed ? 'read' : current.status === 'unread' || current.status === 'read' ? 'reading' : current.status,
      ...(completed ? { finishedAt: current.finishedAt ?? entry.createdAt } : current.status === 'read' ? { finishedAt: undefined } : {}),
      readingLog: [...(current.readingLog ?? []), { ...entry }],
    }),
  };
}

export function readingMarker(entry: Pick<ReadingLogEntry, 'page' | 'progress'>): string {
  return entry.page !== undefined ? `Page ${entry.page.toLocaleString()} · ${entry.progress}%` : `${entry.progress}% read`;
}
