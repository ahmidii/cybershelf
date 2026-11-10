'use client';
import { useEffect, useRef } from 'react';
import type { AppState } from './types';
import { ACCOUNT_ID_HEADER } from './auth-contract';
import { applyCommunityArtworkMatches, artworkLookupIdentity, hasArtworkEdition, usesAutomaticSpine } from './community-artwork';
import { spineCopyIdentity } from './spine-image';
import type { SharedAssetMatch } from './shared-assets';

const REFRESH_MS = 5 * 60_000;
/** Bounded background lookups use edition identifiers only. Account switches,
 * stale library revisions and manual artwork edits never receive old results. */
export function useCommunityArtwork({ state, update, accountId, ready }: {
  state: AppState; update: (change: (current: AppState) => AppState) => void; accountId: string | null; ready: boolean;
}) {
  const current = useRef({ state, update, accountId, ready }); current.current = { state, update, accountId, ready };
  const checked = useRef(new Map<string, number>());
  const sequence = useRef(0);
  const signature = state.books.filter(book => hasArtworkEdition(book) && (usesAutomaticSpine(book) || book.spineAssetId || book.coverAssetId || !book.coverUrl))
    .map(book => spineCopyIdentity(book) + ':' + usesAutomaticSpine(book)).join(';');
  useEffect(() => { checked.current.clear(); }, [accountId]);
  useEffect(() => {
    if (!ready) return;
    const session = ++sequence.current, controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState === 'hidden' || !current.current.ready || current.current.accountId !== accountId) return;
      const now = Date.now();
      const candidates = current.current.state.books.filter(book => hasArtworkEdition(book) && (usesAutomaticSpine(book) || book.spineAssetId || book.coverAssetId || !book.coverUrl)
        && now - (checked.current.get(spineCopyIdentity(book) + ':' + usesAutomaticSpine(book)) ?? 0) >= REFRESH_MS);
      if (!candidates.length) return;
      busy = true;
      try {
        for (let offset = 0; offset < candidates.length; offset += 40) {
          if (controller.signal.aborted || current.current.accountId !== accountId || !current.current.ready) break;
          const books = candidates.slice(offset, offset + 40), expected = new Map(books.map(book => [book.id, artworkLookupIdentity(book)]));
          const response = await fetch('/api/community-assets/resolve', {
            method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(accountId ? { [ACCOUNT_ID_HEADER]: accountId } : {}) },
            body: JSON.stringify({ books: books.map(({ id, catalogId, editionId, isbn }) => ({ id, catalogId, editionId, isbn })) }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          });
          if (!response.ok) break; // Library editing is independent of catalogue availability.
          const result = await response.json() as { matches: SharedAssetMatch[]; truncated?: boolean };
          if (!Array.isArray(result.matches) || controller.signal.aborted || sequence.current !== session || current.current.accountId !== accountId || !current.current.ready) break;
          for (const book of books) checked.current.set(spineCopyIdentity(book) + ':' + usesAutomaticSpine(book), Date.now());
          // An incomplete set is not evidence that a selected image was
          // withdrawn. Keep choices until a complete lookup can resolve them.
          if (result.truncated) continue;
          current.current.update(library => applyCommunityArtworkMatches(library, result.matches, expected));
        }
      } catch { /* A later focus/refresh retries; no private edit is discarded. */ }
      finally { busy = false; }
    };
    const timer = setTimeout(() => void refresh(), 350);
    const onFocus = () => void refresh();
    const onChanged = () => { checked.current.clear(); void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('cybershelf:community-artwork', onChanged);
    const interval = setInterval(onFocus, REFRESH_MS);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(interval); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('cybershelf:community-artwork', onChanged); };
  }, [accountId, ready, signature]);
}
