import type { AppState, Book } from './types';
import { canonicalISBN, spineCopyIdentity } from './spine-image';
import { sharedAssetImageUrl, sharedAssetMatchesEdition, type SharedAsset, type SharedAssetMatch } from './shared-assets';

export function hasArtworkEdition(book: Pick<Book, 'catalogId' | 'editionId' | 'isbn'>): boolean {
  return !!canonicalISBN(book.isbn) || !!(book.catalogId?.startsWith('OL') && /^OL[1-9]\d{0,11}M$/.test(book.editionId ?? ''));
}

export function usesAutomaticSpine(book: Pick<Book, 'spineMode' | 'spineUrl'>): boolean {
  return book.spineMode === 'auto' || (!book.spineMode && !book.spineUrl);
}

/** A catalogue response must not undo an artwork choice made while it loaded. */
export function artworkLookupIdentity(book: Book): string {
  return JSON.stringify([spineCopyIdentity(book), book.spineMode ?? '', book.spineAssetId ?? '', book.spineUrl ?? '', book.coverAssetId ?? '', book.coverUrl]);
}

/** Only public, matching artwork can become another reader's selection. */
export function selectCommunityArtwork(book: Book, asset: SharedAsset, automatic = false): Book {
  if (asset.status !== 'approved' || asset.kind === 'decor' || !sharedAssetMatchesEdition(asset, book)) return book;
  const url = sharedAssetImageUrl(asset.id);
  if (asset.kind === 'cover') return { ...book, coverUrl: url, coverAssetId: asset.id };
  return { ...book, spineUrl: url, spineAssetId: asset.id, spineMode: automatic ? 'auto' : 'custom' };
}

/** Apply to the current library after an asynchronous lookup. Never replace a
 * private choice or attach a result to a copy whose edition changed meanwhile. */
export function applyCommunityArtworkMatches(state: AppState, matches: readonly SharedAssetMatch[], expected: ReadonlyMap<string, string>): AppState {
  const byId = new Map(matches.map(match => [match.bookId, match]));
  let changed = false;
  const books = state.books.map(book => {
    const match = byId.get(book.id);
    if (!match || expected.get(book.id) !== artworkLookupIdentity(book)) return book;
    const available = match.alternatives.filter(asset => asset.status === 'approved' && sharedAssetMatchesEdition(asset, book));
    let next = book;
    if (book.spineAssetId && !available.some(asset => asset.id === book.spineAssetId && asset.kind === 'spine')) {
      next = { ...next, spineAssetId: undefined, ...(book.spineUrl === sharedAssetImageUrl(book.spineAssetId) ? { spineUrl: undefined } : {}) };
    }
    if (book.coverAssetId && !available.some(asset => asset.id === book.coverAssetId && asset.kind === 'cover')) {
      next = { ...next, coverAssetId: undefined, ...(book.coverUrl === sharedAssetImageUrl(book.coverAssetId) ? { coverUrl: '' } : {}) };
    }
    // Keep an existing approved automatic choice when new variants arrive.
    // A reader can compare those alternatives in Book details.
    if (usesAutomaticSpine(next) && !next.spineAssetId && match.spine && available.some(asset => asset.id === match.spine!.id)) next = selectCommunityArtwork(next, match.spine, true);
    if (!next.coverUrl && match.cover && available.some(asset => asset.id === match.cover!.id)) next = selectCommunityArtwork(next, match.cover, true);
    if (next.spineUrl === book.spineUrl && next.spineAssetId === book.spineAssetId && next.spineMode === book.spineMode && next.coverUrl === book.coverUrl && next.coverAssetId === book.coverAssetId) return book;
    changed = true;
    return next;
  });
  return changed ? { ...state, books } : state;
}
