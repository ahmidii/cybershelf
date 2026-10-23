import type { Book, PublicBook } from './types';
import { readingBookKey } from './reading';
import { bookReadingProgress, validPageCount, type ReadingPositionInput } from './reading-progress';

type ViewBook = Pick<Book, 'pages' | 'progress' | 'status'>;

/** Page entry always refers to a copy in the viewer's library. A public
 * author's page count must never silently become the viewer's edition. */
export function ownReadingCopy(book: Pick<PublicBook, 'title' | 'author'>, books: Book[]): Book | undefined {
  const key = readingBookKey(book);
  return books.filter(candidate => readingBookKey(candidate) === key).reduce<Book | undefined>((chosen, candidate) => {
    if (!chosen || bookReadingProgress(candidate) > bookReadingProgress(chosen)) return candidate;
    if (bookReadingProgress(candidate) === bookReadingProgress(chosen) && !validPageCount(chosen.pages) && validPageCount(candidate.pages)) return candidate;
    return chosen;
  }, undefined);
}

export function viewReadingBook(book: Pick<PublicBook, 'title' | 'author'>, books: Book[], progress: number, localPages?: number): ViewBook {
  const copy = ownReadingCopy(book, books);
  const pages = validPageCount(copy?.pages) ? copy.pages : validPageCount(localPages) ? localPages : undefined;
  return { pages, progress, status: progress === 100 ? 'read' : 'reading' };
}

/** This is only an input suggestion. The active spoiler ceiling stays at its
 * original exact fraction until the viewer explicitly applies a new place. */
export function pageFirstViewInput(book: ViewBook): ReadingPositionInput {
  return { mode: 'page', marker: validPageCount(book.pages) ? String(Math.floor(book.pages * bookReadingProgress(book) / 100 + 1e-9)) : '' };
}
