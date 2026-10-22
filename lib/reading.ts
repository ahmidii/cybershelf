import type { Book, PublicBook } from './types';

const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/** A conservative work match: never infer that a similar title is the same book. */
export function readingBookKey(book: Pick<PublicBook, 'title' | 'author'>): string {
  return JSON.stringify([normalized(book.title), normalized(book.author)]);
}

export function readerPosition(book: PublicBook, books: Book[]): { progress: number; unread: boolean } {
  const key = readingBookKey(book);
  const matching = books.filter(candidate => readingBookKey(candidate) === key);
  const progress = Math.max(0, ...matching.map(candidate => candidate.status === 'read' ? 100 :
    Number.isFinite(candidate.progress) ? Math.min(100, Math.max(0, candidate.progress)) : 0));
  return { progress, unread: progress === 0 };
}

export function progressLabel(progress: number, page?: number): string {
  const percentage = Math.round(Math.min(100, Math.max(0, progress)) * 10) / 10;
  return page === undefined ? `${percentage}%` : `Page ${page} · ${percentage}%`;
}

export function readingDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
