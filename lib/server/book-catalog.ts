import { HttpError } from './http';
import { editionAppearance, type EditionAppearance } from '../book-size';

let lastRequest = 0;
const editions = new Map<string, { expires: number; value: EditionAppearance | null }>();
const inFlight = new Map<string, Promise<EditionAppearance | null>>();

/** Search and a selected edition share the conservative, unidentified API limit.
 * This is a per-isolate courtesy limit; no bulk enrichment is performed. */
export async function openLibraryJSON(url: URL): Promise<unknown> {
  if (url.origin !== 'https://openlibrary.org') throw new Error('Unsupported catalog host');
  if (Date.now() - lastRequest < 1000) throw new HttpError(429, 'Please wait a moment before looking up another book.');
  lastRequest = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      headers: { 'User-Agent': 'cybershelf/0.2 (https://cybershelf.io)', 'Accept': 'application/json' },
    });
  } catch { throw new HttpError(503, 'The book catalog is taking a break. Your book can still use an estimated size.'); }
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(503, 'The book catalog is unavailable. Your book can still use an estimated size.');
  return response.json();
}

export async function lookupEdition(isbn: string): Promise<EditionAppearance | null> {
  const cached = editions.get(isbn);
  if (cached && cached.expires > Date.now()) return cached.value;
  let pending = inFlight.get(isbn);
  if (!pending) {
    pending = (async () => {
      const data = await openLibraryJSON(new URL(`https://openlibrary.org/isbn/${isbn}.json`));
      const value = editionAppearance(data, isbn) ?? null;
      if (editions.size >= 200) editions.delete(editions.keys().next().value!);
      editions.set(isbn, { expires: Date.now() + 86400000, value });
      return value;
    })();
    inFlight.set(isbn, pending);
  }
  try { return await pending; } finally { inFlight.delete(isbn); }
}
