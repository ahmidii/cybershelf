import type { AppState } from './types';

export const BROWSER_DRAFT_KEY = 'cybershelf.browser-draft.v1';

/** Importing a browser draft may replace only the untouched starter shelf.
 * An empty book list alone does not mean a reader's shelves are disposable. */
export function canRestoreBrowserDraft(state: AppState): boolean {
  if (state.books.length || state.connections?.length || state.profile.featuredShelfId || state.shelves.length > 1) return false;
  return state.shelves.every(shelf => shelf.title === 'A shelf of my own'
    && !shelf.description && shelf.bookcase === 'open' && shelf.layout === 'balanced'
    && shelf.finish === 'paper' && !shelf.items.length && !shelf.publicId);
}

export function adoptBrowserDraft(current: AppState, draft: AppState): AppState {
  if (!canRestoreBrowserDraft(current)) {
    throw new Error('Your account already has a collection. Export the browser draft and import the books you want to keep.');
  }
  return {
    ...draft,
    profile: {
      ...draft.profile,
      // Signing up is an explicit identity choice. A guest preview name must
      // not silently replace it; an existing account bio also wins.
      name: current.profile.name,
      bio: current.profile.bio || draft.profile.bio,
    },
  };
}

/** Call only after the imported collection has been saved to the account.
 * Another tab may have started a different guest draft while saving. */
export function removeSavedBrowserDraft(storage: Pick<Storage, 'getItem' | 'removeItem'>, importedRaw: string): boolean {
  if (storage.getItem(BROWSER_DRAFT_KEY) !== importedRaw) return false;
  storage.removeItem(BROWSER_DRAFT_KEY);
  return true;
}
