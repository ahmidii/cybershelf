import { HttpError } from './http';
import { editionAppearance, normalizeBookISBN, type EditionAppearance } from '../book-size';
import {
  CATALOG_EDITIONS_PAGE_SIZE, catalogMatchText,
  normalizeOpenLibraryEditionId, normalizeOpenLibraryWorkId,
  type CatalogBook, type CatalogCandidate, type CatalogEdition, type CatalogResolution,
} from '../book-catalog';

const ORIGIN = 'https://openlibrary.org';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_QUEUE_DELAY = 8000;
const CATALOG_UNAVAILABLE = 'The book catalog is temporarily unavailable. Please try again shortly.';
let nextRequestAt = 0;
let cacheBytes = 0;
const cache = new Map<string, { expires: number; bytes: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, limit = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
function strings(value: unknown, limit = 20, length = 200): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 100).map(item => text(item, length)).filter(Boolean))].slice(0, limit);
}
function positiveInteger(value: unknown, maximum = 100000): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : undefined;
}
function coverUrl(value: unknown, size: 'M' | 'L' = 'M'): string {
  const id = positiveInteger(value, Number.MAX_SAFE_INTEGER);
  return id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : '';
}
function firstCover(value: unknown, size: 'M' | 'L' = 'M'): string {
  return Array.isArray(value) ? value.slice(0, 100).map(id => coverUrl(id, size)).find(Boolean) ?? '' : '';
}
function validateCatalogURL(url: URL): void {
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.href.length > 3000 ||
    !/^\/(?:search\.json|works\/OL[1-9]\d{0,11}W(?:\/editions)?\.json|books\/OL[1-9]\d{0,11}M\.json|authors\/OL[1-9]\d{0,11}A\.json|isbn\/(?:\d{9}[\dX]|\d{13})\.json)$/.test(url.pathname)) {
    throw new HttpError(400, 'Choose a valid book catalog identifier.');
  }
}

/** A bounded per-isolate courtesy queue, shared by search, work and ISBN reads.
 * Open Library permits 1 request/second without a verified contact identity.
 * Cloudflare isolates do not coordinate this limit; CDN/public response caching
 * reduces repeat lookups. This is not a distributed abuse-control guarantee. */
async function requestSlot(): Promise<void> {
  const now = Date.now();
  const delay = Math.max(0, nextRequestAt - now);
  if (delay > MAX_QUEUE_DELAY) throw new HttpError(429, 'The book catalog is busy. Please try again in a moment.');
  nextRequestAt = now + delay + 1050;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
}

async function fetchCatalogJSON(url: URL, redirects = 0): Promise<{ value: unknown; bytes: number }> {
  validateCatalogURL(url);
  await requestSlot();
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(6000), redirect: 'manual', credentials: 'omit',
      headers: { 'User-Agent': 'cybershelf/0.5 (https://cybershelf.io)', 'Accept': 'application/json' },
    });
  } catch { throw new HttpError(503, CATALOG_UNAVAILABLE); }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects >= 3) throw new HttpError(503, CATALOG_UNAVAILABLE);
    let target: URL;
    try { target = new URL(location, url); validateCatalogURL(target); }
    catch { throw new HttpError(503, CATALOG_UNAVAILABLE); }
    return fetchCatalogJSON(target, redirects + 1);
  }
  if (response.status === 404) { await response.body?.cancel(); return { value: null, bytes: 0 }; }
  if (!response.ok) { await response.body?.cancel(); throw new HttpError(503, CATALOG_UNAVAILABLE); }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new HttpError(503, CATALOG_UNAVAILABLE);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new HttpError(503, CATALOG_UNAVAILABLE); }
      chunks.push(value);
    }
  } catch { throw new HttpError(503, CATALOG_UNAVAILABLE); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)), bytes: length }; }
  catch { throw new HttpError(503, CATALOG_UNAVAILABLE); }
}

function removeCached(key: string): void {
  const entry = cache.get(key);
  if (entry) cacheBytes -= entry.bytes;
  cache.delete(key);
}

/** Public bibliographic data only. Credential-bearing URLs, arbitrary upstream
 * hosts and redirects out of the JSON catalog are never fetched. */
export async function openLibraryJSON(url: URL): Promise<unknown> {
  validateCatalogURL(url);
  const key = url.href;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    cache.delete(key); cache.set(key, cached);
    return cached.value;
  }
  if (cached) removeCached(key);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const result = await fetchCatalogJSON(url);
    const ttl = result.value === null ? 5 * 60000 : url.pathname === '/search.json' ? 3600000 : 86400000;
    while (cache.size >= 150 || cacheBytes + result.bytes > MAX_CACHE_BYTES) removeCached(cache.keys().next().value!);
    cache.set(key, { ...result, expires: Date.now() + ttl }); cacheBytes += result.bytes;
    return result.value;
  })();
  inFlight.set(key, pending);
  try { return await pending; } finally { inFlight.delete(key); }
}

export async function lookupEdition(isbn: string): Promise<EditionAppearance | null> {
  const validISBN = normalizeBookISBN(isbn);
  if (!validISBN) return null;
  const data = await openLibraryJSON(new URL(`${ORIGIN}/isbn/${validISBN}.json`));
  return editionAppearance(data, validISBN) ?? null;
}

export type CatalogWork = Omit<CatalogBook, 'editions' | 'editionCount' | 'editionsOffset' | 'nextEditionsOffset'>;

/** Work metadata deliberately excludes ISBNs and page counts. Those belong to
 * the specific edition the reader selects, not an arbitrary work search hit. */
export async function lookupCatalogWork(value: string): Promise<CatalogWork | null> {
  const workId = normalizeOpenLibraryWorkId(value);
  if (!workId) throw new HttpError(400, 'Choose a valid book catalog identifier.');
  const data = await openLibraryJSON(new URL(`${ORIGIN}/works/${workId}.json`));
  if (data === null) return null;
  const work = record(data);
  if (normalizeOpenLibraryWorkId(work.key) !== workId || !text(work.title)) throw new HttpError(503, CATALOG_UNAVAILABLE);
  const summaryURL = new URL(`${ORIGIN}/search.json`);
  summaryURL.searchParams.set('q', `key:/works/${workId}`);
  summaryURL.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i');
  summaryURL.searchParams.set('limit', '1');
  const summaryData = record(await openLibraryJSON(summaryURL));
  const summary = Array.isArray(summaryData.docs)
    ? record(summaryData.docs.find(item => normalizeOpenLibraryWorkId(record(item).key) === workId)) : {};
  let authors = strings(summary.author_name, 12, 200);
  // Newly edited works can be absent from the search index. Resolve a bounded
  // handful of their author records instead of borrowing another work's author.
  if (!authors.length && Array.isArray(work.authors)) {
    const keys = [...new Set(work.authors.slice(0, 4).map(item => record(record(item).author).key)
      .filter((key): key is string => typeof key === 'string' && /^\/authors\/OL[1-9]\d{0,11}A$/.test(key)))];
    for (const key of keys) {
      const author = record(await openLibraryJSON(new URL(`${ORIGIN}${key}.json`)));
      const name = author.key === key ? text(author.name, 200) : '';
      if (name) authors.push(name);
    }
  }
  authors = [...new Set(authors)];
  const firstPublished = text(work.first_publish_date, 100) || (positiveInteger(summary.first_publish_year, 9999) ? String(summary.first_publish_year) : '');
  return {
    id: workId, source: 'openlibrary', title: text(work.title), author: text(authors.join(', ')) || 'Unknown author', authors,
    description: text(typeof work.description === 'string' ? work.description : record(work.description).value, 10000),
    coverUrl: firstCover(work.covers, 'L') || coverUrl(summary.cover_i, 'L'),
    ...(firstPublished ? { firstPublished } : {}), subjects: strings(work.subjects, 20, 100),
    sourceUrl: `${ORIGIN}/works/${workId}`,
  };
}

function catalogEdition(value: unknown, workId: string): CatalogEdition | null {
  const data = record(value);
  const editionId = normalizeOpenLibraryEditionId(data.key);
  if (!editionId || !text(data.title)) return null;
  if (Array.isArray(data.works) && !data.works.some(item => normalizeOpenLibraryWorkId(record(item).key) === workId)) return null;
  const isbns = [data.isbn_13, data.isbn_10].flatMap(value => Array.isArray(value) ? value.slice(0, 20) : []);
  const isbn = isbns.map(normalizeBookISBN).find(Boolean);
  const pages = positiveInteger(data.number_of_pages);
  const publishDate = text(data.publish_date, 100);
  const physicalFormat = text(data.physical_format, 100);
  const languages = Array.isArray(data.languages) ? [...new Set(data.languages.slice(0, 20)
    .map(value => typeof record(value).key === 'string' ? /^\/languages\/([a-z]{3})$/.exec(String(record(value).key))?.[1] : undefined)
    .filter((value): value is string => Boolean(value)))] : [];
  return {
    editionId, title: text(data.title), coverUrl: firstCover(data.covers),
    ...(isbn ? { isbn } : {}), ...(pages ? { pages } : {}), ...(publishDate ? { publishDate } : {}),
    publishers: strings(data.publishers, 6, 200), languages, ...(physicalFormat ? { physicalFormat } : {}),
  };
}

export async function lookupCatalogBook(workId: string, editionsOffset = 0): Promise<CatalogBook | null> {
  if (!Number.isInteger(editionsOffset) || editionsOffset < 0 || editionsOffset > 100000) throw new HttpError(400, 'Choose a valid edition page.');
  const work = await lookupCatalogWork(workId);
  if (!work) return null;
  const url = new URL(`${ORIGIN}/works/${work.id}/editions.json`);
  url.searchParams.set('limit', String(CATALOG_EDITIONS_PAGE_SIZE));
  url.searchParams.set('offset', String(editionsOffset));
  const data = record(await openLibraryJSON(url));
  if (!Array.isArray(data.entries) || typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size < 0) {
    throw new HttpError(503, CATALOG_UNAVAILABLE);
  }
  const entries = data.entries.slice(0, CATALOG_EDITIONS_PAGE_SIZE);
  const editions: CatalogEdition[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const edition = catalogEdition(entry, work.id);
    if (edition && !seen.has(edition.editionId)) { editions.push(edition); seen.add(edition.editionId); }
  }
  const next = editionsOffset + entries.length;
  return { ...work, editions, editionCount: data.size, editionsOffset, nextEditionsOffset: entries.length && next < data.size && next <= 100000 ? next : null };
}

function candidate(value: unknown): CatalogCandidate | null {
  const data = record(value);
  const catalogId = normalizeOpenLibraryWorkId(data.key);
  if (!catalogId || !text(data.title)) return null;
  const year = positiveInteger(data.first_publish_year, 9999);
  return {
    catalogId, title: text(data.title), author: text(strings(data.author_name, 12, 200).join(', ')) || 'Unknown author',
    coverUrl: coverUrl(data.cover_i), ...(year ? { firstPublished: String(year) } : {}),
  };
}

/** Resolution runs only for a reader's deliberate lookup, never for a bulk
 * private-library scan. An ISBN must appear on its returned edition; otherwise
 * we offer candidates and accept only a complete, unique title/author match. */
export async function resolveCatalogBook(input: { isbn?: string; title?: string; author?: string }): Promise<CatalogResolution> {
  const isbn = normalizeBookISBN(input.isbn);
  if (isbn) {
    const data = record(await openLibraryJSON(new URL(`${ORIGIN}/isbn/${isbn}.json`)));
    const editionId = normalizeOpenLibraryEditionId(data.key);
    const works = Array.isArray(data.works) ? [...new Set(data.works.map(item => normalizeOpenLibraryWorkId(record(item).key)).filter((id): id is string => Boolean(id)))] : [];
    if (editionId && works.length === 1 && editionAppearance(data, isbn)) {
      return { match: { catalogId: works[0], editionId }, candidates: [] };
    }
  }
  const title = text(input.title), author = text(input.author);
  if (!title) return { match: null, candidates: [] };
  const authorKnown = Boolean(author && !/^(?:unknown(?: author)?|anonymous|various(?: authors)?)$/i.test(author));
  const url = new URL(`${ORIGIN}/search.json`);
  url.searchParams.set('title', title);
  if (authorKnown) url.searchParams.set('author', author);
  url.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year');
  url.searchParams.set('limit', '20');
  const data = record(await openLibraryJSON(url));
  if (!Array.isArray(data.docs)) throw new HttpError(503, CATALOG_UNAVAILABLE);
  const candidates: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const value of data.docs.slice(0, 20)) {
    const entry = candidate(value);
    if (entry && !seen.has(entry.catalogId)) { candidates.push(entry); seen.add(entry.catalogId); }
  }
  const found = typeof data.numFound === 'number' ? data.numFound : data.num_found;
  // A truncated result set cannot prove uniqueness, even if its top match looks
  // exact. Explicit candidate selection remains available in that case.
  const complete = typeof found === 'number' && Number.isSafeInteger(found) && found >= 0 && found <= data.docs.length && data.numFoundExact !== false;
  const exact = authorKnown ? candidates.filter(item => catalogMatchText(item.title) === catalogMatchText(title) && catalogMatchText(item.author) === catalogMatchText(author)) : [];
  return { match: complete && exact.length === 1 ? { catalogId: exact[0].catalogId } : null, candidates: candidates.slice(0, 8) };
}
