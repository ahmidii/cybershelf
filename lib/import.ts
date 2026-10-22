import { newBook, shelfCapacity, shelfGrid, shelfPlacementError, uid } from './types';
import type { AppState, Book, BookSource, ImportedBookFields, LibraryConnection, ReadingLogEntry, ReadingStatus, Shelf, ShelfItem } from './types';
import { validBookDimensions } from './book-size';

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_BOOKS = 2000;
const colors = ['#6d7b67', '#b46c4d', '#d0ab62', '#416974', '#8a697a', '#d2c2a2', '#414b50', '#8b9c9b'];

export function bookColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

/** Sample local artwork into a small palette, keeping cover-color grouping
 * useful without depending on a remote image host's canvas permissions. */
export async function extractCoverColor(blob: Blob, fallback = '#6d7b67'): Promise<string> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return fallback;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32 });
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    context.drawImage(bitmap, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const buckets = new Map<string, { count: number; r: number; g: number; b: number; weight: number }>();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 128) continue;
      const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const high = Math.max(r, g, b), low = Math.min(r, g, b), saturation = high ? (high - low) / high : 0;
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, weight: 0 };
      bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
      bucket.weight += .55 + saturation + (high > 40 && low < 235 ? .2 : 0);
      buckets.set(key, bucket);
    }
    const dominant = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
    if (!dominant) return fallback;
    return '#' + [dominant.r, dominant.g, dominant.b].map(channel => Math.round(channel / dominant.count).toString(16).padStart(2, '0')).join('');
  } catch { return fallback; }
  finally { bitmap?.close(); }
}

function sizeOf(text: string): number { return new TextEncoder().encode(text).byteLength; }

/** A small RFC 4180 parser: escaped quotes and embedded newlines stay in their
 * original field. Bounds are checked while parsing, before creating book rows. */
function csvRows(input: string): string[][] {
  if (sizeOf(input) > MAX_CSV_BYTES) throw new Error('This CSV is larger than 10 MB. Split it into smaller imports.');
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closedQuote = false;
  const pushField = () => {
    row.push(field); field = ''; closedQuote = false;
    if (row.length > 100) throw new Error('This CSV has too many columns. Choose a Goodreads library export.');
  };
  const pushRow = () => {
    pushField();
    if (row.some(value => value.trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_BOOKS + 1) throw new Error('Import up to 2,000 books at a time. Split this CSV into smaller files.');
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === '"' && !field && !closedQuote) quoted = true;
    else if (char === ',') pushField();
    else if (char === '\n' || char === '\r') { pushRow(); if (char === '\r' && text[index + 1] === '\n') index++; }
    else if (closedQuote && /[ \t]/.test(char)) continue;
    else if (closedQuote) throw new Error(`The CSV contains an unexpected character after a closing quote near row ${rows.length + 1}.`);
    else field += char;
    // A complete, bounded reading log can hold 200 thoughts of 4,000 characters.
    // Keep it in one portable CSV field while the whole upload remains capped.
    if (field.length > 1_000_000) throw new Error('A CSV field is larger than 1 MB. Split very large imports into smaller files.');
  }
  if (quoted) throw new Error('The CSV ends inside a quoted field. Export it again and try the complete file.');
  if (field || row.length || closedQuote) pushRow();
  return rows;
}

function normalizeISBN(raw: string): string | undefined {
  const value = raw.trim().replace(/^=\s*["']?(.*?)["']?$/, '$1').replace(/[\s-]/g, '').toUpperCase();
  return /^(?:\d{9}[\dX]|\d{13})$/.test(value) ? value : undefined;
}

function dateValue(raw: string): string | undefined {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:T.*)?$/.exec(raw.trim());
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

export function parseGoodreadsCSV(text: string): { books: Book[]; warnings: string[] } {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error('This CSV has no book rows. Choose your Goodreads library export.');
  const header = rows[0].map(value => value.trim().toLowerCase());
  if (!header.includes('title')) throw new Error('A Title column is required. Choose a Goodreads library export or a cybershelf CSV.');
  const warnings: string[] = [];
  let skipped = 0, clipped = 0;
  const books: Book[] = [];
  for (const row of rows.slice(1)) {
    const get = (name: string) => row[header.indexOf(name.toLowerCase())]?.trim() ?? '';
    const clip = (value: string, limit: number) => { if (value.length > limit) clipped++; return value.slice(0, limit); };
    const title = clip(get('title'), 500);
    if (!title) { skipped++; continue; }
    const author = clip(get('author') || get('authors') || 'Unknown author', 500);
    const book = newBook(title, author);
    book.isbn = normalizeISBN(get('isbn13')) ?? normalizeISBN(get('isbn'));
    book.color = bookColor(title + author);
    const status = get('exclusive shelf').toLowerCase();
    const statusMap: Record<string, ReadingStatus> = { 'to-read': 'unread', 'currently-reading': 'reading', 'read': 'read', 'paused': 'paused', 'did-not-finish': 'dnf', 'dnf': 'dnf' };
    book.status = statusMap[status] ?? 'unread';
    const rating = Number(get('my rating'));
    book.rating = rating > 0 && rating <= 5 ? Math.round(rating * 2) / 2 : null;
    book.review = clip(get('my review'), 20000);
    book.notes = clip(get('private notes'), 30000);
    book.addedAt = dateValue(get('date added')) ?? book.addedAt;
    book.finishedAt = dateValue(get('date read'));
    const pages = Number(get('number of pages'));
    if (Number.isInteger(pages) && pages > 0 && pages <= 100000) book.pages = pages;
    const format = get('book format');
    if (['paperback', 'hardcover', 'pocket', 'large'].includes(format)) book.format = format as Book['format'];
    const measurements = [get('height (mm)'), get('cover width (mm)'), get('spine thickness (mm)')];
    if (measurements.some(Boolean)) {
      const dimensions = { heightMm: Number(measurements[0]), widthMm: Number(measurements[1]), thicknessMm: Number(measurements[2]), source: get('size source') || 'manual' };
      if (measurements.every(Boolean) && validBookDimensions(dimensions)) book.dimensions = dimensions;
      else warnings.push(`“${title}”: incomplete or invalid measurements were replaced with an automatic size estimate.`);
    }
    const spineColor = get('spine color');
    if (/^#[\da-f]{6}$/i.test(spineColor)) book.color = spineColor;
    for (const [column, property] of [['cover image url', 'coverUrl'], ['spine image url', 'spineUrl']] as const) {
      const image = get(column);
      if (image) { try { book[property] = url(image, `${title} ${column}`, true); } catch { warnings.push(`“${title}”: an invalid ${column} was skipped.`); } }
    }
    const readingLog = get('reading log');
    if (readingLog) { try { book.readingLog = parseReadingLog(JSON.parse(readingLog), `${title} reading log`); } catch { warnings.push(`“${title}”: an invalid reading log was skipped. The book and its other reading details were kept.`); } }
    const progress = Number(get('progress').replace('%', ''));
    book.progress = book.status === 'read' ? 100 : Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
    books.push(book);
  }
  const merged = mergeBooks([], books);
  if (skipped) warnings.push(`${skipped} ${skipped === 1 ? 'row had' : 'rows had'} no title and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  if (clipped) warnings.push(`${clipped} unusually long ${clipped === 1 ? 'field was' : 'fields were'} shortened to fit your library.`);
  if (merged.duplicates) warnings.push(`${merged.duplicates} duplicate ${merged.duplicates === 1 ? 'book was' : 'books were'} combined. The first entry was kept.`);
  if (!merged.books.length) throw new Error('No books with a title were found in this CSV.');
  return { books: merged.books, warnings };
}

function titleKey(book: Book): string {
  const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${normalize(book.title)}\u0000${normalize(book.author)}`;
}

/** Existing records win. Re-importing cannot replace reviews, notes, or links. */
export function mergeBooks(existing: Book[], incoming: Book[]): { books: Book[]; added: number; duplicates: number } {
  const books = [...existing], isbns = new Set<string>(), titleEditions = new Map<string, Set<string>>();
  const readingIds = new Set(existing.flatMap(book => book.readingLog?.map(entry => entry.id) ?? []));
  const index = (book: Book) => {
    const isbn = normalizeISBN(book.isbn ?? '') ?? '';
    if (isbn) isbns.add(isbn);
    const key = titleKey(book);
    const editions = titleEditions.get(key) ?? new Set<string>();
    editions.add(isbn); titleEditions.set(key, editions);
  };
  existing.forEach(index);
  let duplicates = 0, added = 0;
  for (const book of incoming) {
    const isbn = normalizeISBN(book.isbn ?? '') ?? '', editions = titleEditions.get(titleKey(book));
    if ((isbn && isbns.has(isbn)) || (editions && (!isbn || editions.has('')))) { duplicates++; continue; }
    if (books.length >= MAX_BOOKS) throw new Error('Your library can hold 2,000 books in this release. Remove books or import a smaller selection.');
    const imported = withUniqueReadingIds(book, readingIds);
    books.push(imported); index(imported); added++;
  }
  return { books, added, duplicates };
}

/** File import uses the same edition matching as ordinary catalog import while
 * attaching new originals to existing records. Personal reading data wins. */
export function mergeImportedBooks(existing: Book[], incoming: Book[]): { books: Book[]; added: number; duplicates: number; attached: number } {
  const books = [...existing];
  const readingIds = new Set(existing.flatMap(book => book.readingLog?.map(entry => entry.id) ?? []));
  let added = 0, duplicates = 0, attached = 0;
  for (const imported of incoming) {
    const isbn = normalizeISBN(imported.isbn ?? '') ?? '', key = titleKey(imported);
    const matchingISBN = isbn ? books.findIndex(book => normalizeISBN(book.isbn ?? '') === isbn) : -1;
    const matchingIndex = matchingISBN >= 0 ? matchingISBN : books.findIndex(book => titleKey(book) === key && (!isbn || !normalizeISBN(book.isbn ?? '')));
    if (matchingIndex < 0) {
      if (books.length >= MAX_BOOKS) throw new Error('Your library can hold 2,000 books in this release. Remove books or import a smaller selection.');
      books.push(withUniqueReadingIds(imported, readingIds)); added++; continue;
    }
    duplicates++;
    const current = books[matchingIndex], assets = new Set(current.sources.filter(source => source.kind === 'file').map(source => source.assetId));
    const sourceIds = new Set(current.sources.map(source => source.id)), sources = [...current.sources];
    for (const source of imported.sources) {
      if (source.kind !== 'file' || !source.assetId || assets.has(source.assetId)) continue;
      if (sources.length >= 30) throw new Error(`“${current.title}” already has 30 sources. Remove an unused source before attaching another file.`);
      const sourceId = sourceIds.has(source.id) ? uid('src_') : source.id;
      sources.push({ ...source, id: sourceId }); assets.add(source.assetId); sourceIds.add(sourceId); attached++;
    }
    const cover = !current.coverUrl && imported.coverUrl && imported.sources.some(source => source.kind === 'file')
      ? { coverUrl: imported.coverUrl, color: imported.color } : {};
    books[matchingIndex] = { ...current, ...cover, sources };
  }
  return { books, added, duplicates, attached };
}

/** A copied CSV can contain the same private log IDs under another title.
 * Give only colliding entries fresh private identities; public post IDs are never imported. */
function withUniqueReadingIds(book: Book, used: Set<string>): Book {
  if (!book.readingLog) return book;
  const readingLog = book.readingLog.map(entry => {
    const next = used.has(entry.id) ? { ...entry, id: uid('log_') } : entry;
    used.add(next.id); return next;
  });
  return { ...book, readingLog };
}

type RecordValue = Record<string, unknown>;
function object(value: unknown, context: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid backup: ${context} must be an object.`);
  return value as RecordValue;
}
function list(value: unknown, context: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid backup: ${context} must be a list with at most ${max} entries.`);
  return value;
}
function string(value: unknown, context: string, max: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid backup: ${context} is missing or too long.`);
  return value;
}
function id(value: unknown, context: string): string {
  const text = string(value, context, 100);
  if (!/^[a-z\d_-]+$/i.test(text)) throw new Error(`Invalid backup: ${context} contains an invalid identifier.`);
  return text;
}
function number(value: unknown, context: string, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid backup: ${context} must be between ${min} and ${max}.`);
  return value;
}
function enumValue<T extends string>(value: unknown, values: readonly T[], context: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Invalid backup: ${context} has an unsupported value.`);
  return value as T;
}
function url(value: unknown, context: string, allowAsset = false): string {
  const text = string(value, context, 2048, '');
  if (!text) return '';
  if (allowAsset && /^\/api\/assets\/[a-z\d_-]{1,100}$/i.test(text)) return text;
  if (allowAsset && /^\/api\/(?:publications|profiles|journal)\/[a-z\d_-]{1,100}\/assets\/[a-z\d_-]{1,100}$/i.test(text)) return text;
  try { const parsed = new URL(text); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href; } catch { /* handled below */ }
  throw new Error(`Invalid backup: ${context} must use an http or https URL.`);
}
function date(value: unknown, context: string): string {
  const text = string(value, context, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`Invalid backup: ${context} has an invalid date.`);
  return new Date(text).toISOString();
}
function unique(values: string[], context: string) { if (new Set(values).size !== values.length) throw new Error(`Invalid backup: ${context} contains duplicate IDs.`); }

function parseReadingLog(value: unknown, context: string): ReadingLogEntry[] {
  const entries = list(value, context, 200).map(raw => {
    const entry = object(raw, `${context} entry`);
    const result: ReadingLogEntry = {
      id: id(entry.id, `${context} entry ID`),
      body: string(entry.body, `${context} thought`, 4000, ''),
      progress: number(entry.progress, `${context} progress`, 0, 100),
      createdAt: date(entry.createdAt, `${context} date`),
    };
    if (entry.page !== undefined) {
      result.page = number(entry.page, `${context} page`, 0, 100000);
      if (!Number.isInteger(result.page)) throw new Error(`Invalid backup: ${context} page must be a whole number.`);
    }
    return result;
  });
  unique(entries.map(entry => entry.id), context);
  return entries;
}

/** Restore account-local asset references, never public sharing identities.
 * Restoring on another account does not grant access to the original files. */
export function parseCatalogJSON(text: string): AppState {
  // Pretty-printed backups can be larger than the compact server record.
  if (sizeOf(text) > MAX_CSV_BYTES) throw new Error('This backup file is too large. Book files are backed up separately from the catalog.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose a cybershelf catalog backup.'); }
  if (sizeOf(JSON.stringify(parsed)) > MAX_STATE_BYTES) throw new Error('This backup is larger than the 2 MB catalog limit. Book files are backed up separately.');
  const root = object(parsed, 'catalog');
  if (root.schemaVersion !== 1) throw new Error('This backup uses an unsupported format. Choose a version 1 cybershelf catalog.');
  const profile = object(root.profile, 'profile');
  const connections: LibraryConnection[] | undefined = root.connections === undefined ? undefined : list(root.connections, 'account connections', 10).map(raw => {
    const value = object(raw, 'account connection');
    const accountKey = string(value.accountKey, 'connection account key', 64);
    if (!/^[a-f0-9]{64}$/.test(accountKey)) throw new Error('Invalid backup: an account connection has an invalid identity.');
    if (typeof value.autoSync !== 'boolean' || typeof value.syncProgress !== 'boolean') throw new Error('Invalid backup: connection preferences are missing.');
    const connection: LibraryConnection = { id: id(value.id, 'connection ID'), provider: enumValue(value.provider, ['hardcover'] as const, 'connection provider'), accountKey, label: string(value.label, 'connection label', 80), autoSync: value.autoSync, syncProgress: value.syncProgress, connectedAt: date(value.connectedAt, 'connection date') };
    if (!connection.label.trim()) throw new Error('Invalid backup: an account connection needs a name.');
    if (value.lastSyncedAt !== undefined) connection.lastSyncedAt = date(value.lastSyncedAt, 'last sync date');
    if (value.lastSummary !== undefined) {
      const summary = object(value.lastSummary, 'last sync summary');
      const count = (key: string) => { const amount = number(summary[key], 'sync summary', 0, 2000); if (!Number.isInteger(amount)) throw new Error('Invalid backup: sync counts must be whole numbers.'); return amount; };
      connection.lastSummary = { added: count('added'), updated: count('updated'), preserved: count('preserved') };
    }
    return connection;
  });
  unique((connections ?? []).map(connection => connection.id), 'account connections');
  unique((connections ?? []).map(connection => connection.accountKey), 'connected account identities');
  const connectionIds = new Set(connections?.map(connection => connection.id));
  const remoteRecords = new Set<string>();
  const books: Book[] = list(root.books, 'books', MAX_BOOKS).map((raw, index) => {
    const data = object(raw, `book ${index + 1}`), context = `book ${index + 1}`;
    const color = string(data.color, `${context} color`, 7);
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`Invalid backup: ${context} needs a six-digit hex color.`);
    const sources: BookSource[] = list(data.sources ?? [], `${context} sources`, 30).map((rawSource, sourceIndex) => {
      const source = object(rawSource, `${context} source ${sourceIndex + 1}`);
      const kind = enumValue(source.kind, ['file', 'platform', 'physical', 'link'] as const, 'source kind');
      const result: BookSource = { id: id(source.id, 'source ID'), kind, label: string(source.label, 'source label', 150) };
      if (source.url !== undefined) result.url = url(source.url, 'source URL');
      if (source.assetId !== undefined) result.assetId = id(source.assetId, 'file ID');
      if (kind === 'file' && !result.assetId) throw new Error('Invalid backup: a book file is missing its private file reference.');
      if (source.filename !== undefined) result.filename = string(source.filename, 'source filename', 255);
      if (source.location !== undefined) result.location = string(source.location, 'physical location', 500);
      return result;
    });
    unique(sources.map(source => source.id), `${context} sources`);
    const book: Book = {
      id: id(data.id, `${context} ID`), title: string(data.title, `${context} title`, 500), author: string(data.author, `${context} author`, 500),
      coverUrl: url(data.coverUrl, `${context} cover URL`, true), color,
      status: enumValue(data.status, ['unread', 'reading', 'read', 'paused', 'dnf'] as const, `${context} reading status`),
      progress: number(data.progress, `${context} progress`, 0, 100, 0),
      rating: data.rating === null || data.rating === undefined ? null : number(data.rating, `${context} rating`, 0, 5),
      review: string(data.review, `${context} review`, 20000, ''), notes: string(data.notes, `${context} notes`, 30000, ''),
      addedAt: date(data.addedAt, `${context} added date`), sources,
    };
    if (!book.title.trim()) throw new Error(`Invalid backup: ${context} has no title.`);
    if (data.isbn !== undefined) book.isbn = string(data.isbn, `${context} ISBN`, 32);
    if (data.description !== undefined) book.description = string(data.description, `${context} description`, 10000);
    if (data.readingLog !== undefined) book.readingLog = parseReadingLog(data.readingLog, `${context} reading log`);
    if (data.spineUrl !== undefined) book.spineUrl = url(data.spineUrl, `${context} spine URL`, true);
    if (data.format !== undefined) book.format = enumValue(data.format, ['paperback', 'hardcover', 'pocket', 'large'] as const, `${context} book format`);
    if (data.dimensions !== undefined) {
      const dimensions = object(data.dimensions, `${context} dimensions`);
      book.dimensions = {
        heightMm: number(dimensions.heightMm, `${context} height`, 100, 500),
        widthMm: number(dimensions.widthMm, `${context} cover width`, 60, 400),
        thicknessMm: number(dimensions.thicknessMm, `${context} spine thickness`, 2, 150),
        source: enumValue(dimensions.source, ['estimated', 'catalog', 'manual'] as const, `${context} size source`),
      };
    }
    if (data.pages !== undefined) {
      book.pages = number(data.pages, `${context} pages`, 0, 100000);
      if (!Number.isInteger(book.pages)) throw new Error(`Invalid backup: ${context} pages must be a whole number.`);
    }
    if (data.finishedAt !== undefined) book.finishedAt = date(data.finishedAt, `${context} finished date`);
    if (data.connections !== undefined) book.connections = list(data.connections, 'linked account records', 20).map(raw => {
      const link = object(raw, 'linked account record');
      const connectionId = id(link.connectionId, 'linked connection ID'), remoteId = id(link.remoteId, 'remote book ID');
      if (!connectionIds.has(connectionId)) throw new Error('Invalid backup: a book refers to a missing account connection.');
      const key = connectionId + ':' + remoteId;
      if (remoteRecords.has(key)) throw new Error('Invalid backup: a connected book is linked more than once.');
      remoteRecords.add(key);
      const fields = object(link.lastImported, 'last imported metadata'), lastImported: ImportedBookFields = {};
      for (const key of ['title', 'author', 'isbn'] as const) if (fields[key] !== undefined) lastImported[key] = string(fields[key], 'imported ' + key, key === 'isbn' ? 32 : 500);
      if (fields.coverUrl !== undefined) lastImported.coverUrl = url(fields.coverUrl, 'imported cover URL', true);
      if (fields.pages !== undefined) { lastImported.pages = number(fields.pages, 'imported pages', 0, 100000); if (!Number.isInteger(lastImported.pages)) throw new Error('Invalid backup: imported pages must be whole numbers.'); }
      if (fields.status !== undefined) lastImported.status = enumValue(fields.status, ['unread', 'reading', 'read', 'paused', 'dnf'] as const, 'imported status');
      if (fields.progress !== undefined) lastImported.progress = number(fields.progress, 'imported progress', 0, 100);
      if (fields.rating !== undefined) lastImported.rating = fields.rating === null ? null : number(fields.rating, 'imported rating', 0, 5);
      return { connectionId, remoteId, sourceId: id(link.sourceId, 'connected source ID'), lastImported };
    });
    return book;
  });
  unique(books.map(book => book.id), 'books');
  unique(books.flatMap(book => book.readingLog?.map(entry => entry.id) ?? []), 'reading log entries');
  const bookIds = new Set(books.map(book => book.id));
  const shelves: Shelf[] = list(root.shelves, 'shelves', 100).map((raw, index) => {
    const data = object(raw, `shelf ${index + 1}`);
    const shelf: Shelf = {
      id: id(data.id, 'shelf ID'), title: string(data.title, 'shelf title', 150), description: string(data.description, 'shelf description', 2000, ''),
      bookcase: enumValue(data.bookcase, ['open', 'cubby', 'tower'] as const, 'bookcase'),
      layout: enumValue(data.layout, ['balanced', 'gallery', 'stacks'] as const, 'shelf layout'),
      finish: enumValue(data.finish, ['paper', 'oak', 'moss', 'ink'] as const, 'shelf finish'),
      items: [], updatedAt: date(data.updatedAt, 'shelf updated date'),
    };
    shelf.items = list(data.items, 'shelf items', 2000).map(rawItem => {
      const item = object(rawItem, 'shelf item');
      const slot = item.slot === null ? null : number(item.slot, 'shelf position', 0, 2000);
      if (slot !== null && !Number.isInteger(slot)) throw new Error('Invalid backup: shelf positions must be whole numbers.');
      const result: ShelfItem = {
        id: id(item.id, 'shelf item ID'), kind: enumValue(item.kind, ['book', 'decor'] as const, 'shelf item kind'),
        slot: slot !== null && slot >= shelfCapacity(shelf) ? null : slot, pinned: item.pinned === true,
        facing: enumValue(item.facing ?? 'auto', ['auto', 'spine', 'cover', 'stack'] as const, 'book facing'),
      };
      if (item.placement !== undefined) {
        const placement=object(item.placement,'shelf placement');
        const row=number(placement.row,'shelf row',0,shelfGrid(shelf).rows-1);
        if(!Number.isInteger(row))throw new Error('Invalid backup: shelf rows must be whole numbers.');
        if(slot===null)throw new Error('Invalid backup: an item in the tray cannot have a shelf placement.');
        if(slot>1000)throw new Error('Invalid backup: shelf item identifiers must be at most 1000.');
        result.slot=slot;
        result.placement={row,x:number(placement.x,'shelf placement',0,1),
          ...(placement.supportId===undefined?{}:{supportId:id(placement.supportId,'shelf support')})};
      }
      if (item.lean !== undefined) result.lean = enumValue(item.lean, ['auto', 'upright', 'left', 'right'] as const, 'book lean');
      if (result.kind === 'book') {
        result.bookId = id(item.bookId, 'shelf book ID');
        if (!bookIds.has(result.bookId)) throw new Error('Invalid backup: a shelf refers to a book missing from the catalog.');
      } else {
        result.decor = enumValue(item.decor, ['plant', 'bear', 'robot', 'vase', 'bookend', 'image'] as const, 'decoration');
        if (item.assetId !== undefined) result.assetId = id(item.assetId, 'decoration file ID');
        if (item.imageUrl !== undefined) result.imageUrl = url(item.imageUrl, 'decoration image URL', true);
        if (item.label !== undefined) result.label = string(item.label, 'decoration label', 150);
      }
      return result;
    });
    unique(shelf.items.map(item => item.id), 'shelf items');
    const occupied = shelf.items.filter(item => item.slot !== null).map(item => String(item.slot));
    unique(occupied, 'shelf positions');
    const placementError=shelfPlacementError(shelf);
    if(placementError)throw new Error(`Invalid backup: ${placementError}`);
    return shelf;
  });
  unique(shelves.map(shelf => shelf.id), 'shelves');
  const featuredShelfId = profile.featuredShelfId === undefined ? undefined : id(profile.featuredShelfId, 'featured shelf');
  return { schemaVersion: 1, profile: { name: string(profile.name, 'profile name', 80), bio: string(profile.bio, 'profile bio', 1000, ''), ...(featuredShelfId && shelves.some(shelf => shelf.id === featuredShelfId) ? { featuredShelfId } : {}) }, books, shelves, ...(connections ? { connections } : {}) };
}

interface ZipEntry { path: string; offset: number; method: number; compressed: number; size: number; }
/** Read the central directory first, so untrusted ZIP sizes are bounded before
 * allocating decompression buffers. Only metadata and a small cover are read. */
function zipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('The EPUB ZIP directory could not be read.');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true);
  if (count > 10000 || directoryOffset + directorySize > end) throw new Error('This EPUB contains an unsupported or unusually large ZIP directory.');
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('Split EPUB archives are not supported.');
  const entries = new Map<string, ZipEntry>();
  let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The EPUB ZIP directory is damaged.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('The EPUB ZIP directory is damaged.');
    const path = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!(flags & 1) && (method === 0 || method === 8) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')) entries.set(path, { path, offset, method, compressed, size });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extract(bytes: Uint8Array, entry: ZipEntry, max: number): Promise<Uint8Array> {
  if (entry.size > max || entry.compressed > 25 * 1024 * 1024) throw new Error('EPUB metadata or artwork is too large to preview.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('The EPUB file entry is damaged.');
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  if (start + entry.compressed > bytes.length) throw new Error('The EPUB file entry is incomplete.');
  const compressed = bytes.subarray(start, start + entry.compressed);
  if (entry.method === 0) {
    if (compressed.byteLength !== entry.size) throw new Error('The EPUB contains inconsistent file sizes.');
    return compressed;
  }
  // Stop decompression as soon as the promised or allowed size is exceeded.
  // A streamed browser decoder avoids allocating an unbounded ZIP-bomb output.
  const reader = new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > entry.size || length > max) { await reader.cancel(); throw new Error('The EPUB contains inconsistent file sizes.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  if (length !== entry.size) throw new Error('The EPUB contains inconsistent file sizes.');
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function xmlDocument(bytes: Uint8Array): Document {
  const text = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('EPUB metadata with custom XML entities is not supported.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The EPUB metadata could not be parsed.');
  return doc;
}

function xmlValue(doc: Document, localName: string): string { return doc.getElementsByTagNameNS('*', localName)[0]?.textContent?.trim() ?? ''; }
function zipPath(base: string, href: string): string | undefined {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') || href.includes('\\')) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(href.split('#')[0]); } catch { return undefined; }
  const segments = base.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) { if (segment === '..') { if (!segments.length) return undefined; segments.pop(); } else if (segment && segment !== '.') segments.push(segment); }
  return segments.join('/');
}

export async function readBookFile(file: File): Promise<{ book: Book; warning?: string; cover?: Blob }> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an EPUB or PDF of 25 MB or less.');
  if (!/\.(epub|pdf)$/i.test(file.name)) throw new Error('Choose an EPUB or PDF file.');
  const title = file.name.replace(/\.(epub|pdf)$/i, '').replaceAll('_', ' ').trim().slice(0, 500) || 'Untitled book';
  const book = newBook(title);
  book.color = bookColor(title);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name)) {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('This file does not appear to be a PDF.');
    return { book, warning: 'The title comes from the filename. You can edit its title and author before adding it.' };
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This file does not appear to be an EPUB.');
  try {
    const directory = zipDirectory(bytes), containerEntry = directory.get('META-INF/container.xml');
    if (!containerEntry) throw new Error('No EPUB package information was found.');
    const container = xmlDocument(await extract(bytes, containerEntry, 128 * 1024));
    const packagePath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path') ?? '';
    const packageEntry = directory.get(packagePath);
    if (!packageEntry) throw new Error('The EPUB package is missing.');
    const metadata = xmlDocument(await extract(bytes, packageEntry, 1024 * 1024));
    book.title = xmlValue(metadata, 'title').slice(0, 500) || title;
    book.author = xmlValue(metadata, 'creator').slice(0, 500) || 'Unknown author';
    book.description = xmlValue(metadata, 'description').slice(0, 10000);
    book.color = bookColor(book.title + book.author);
    for (const identifier of Array.from(metadata.getElementsByTagNameNS('*', 'identifier'))) {
      const isbn = normalizeISBN((identifier.textContent ?? '').replace(/^urn:isbn:/i, ''));
      if (isbn) { book.isbn = isbn; break; }
    }
    const manifest = Array.from(metadata.getElementsByTagNameNS('*', 'item'));
    const legacyCoverId = Array.from(metadata.getElementsByTagNameNS('*', 'meta')).find(node => node.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem = manifest.find(node => (node.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image')) ?? manifest.find(node => node.getAttribute('id') === legacyCoverId);
    const coverPath = coverItem ? zipPath(packagePath, coverItem.getAttribute('href') ?? '') : undefined;
    const coverEntry = coverPath ? directory.get(coverPath) : undefined;
    const mediaType = coverItem?.getAttribute('media-type');
    if (coverEntry && coverEntry.size <= 4 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(mediaType ?? '')) {
      try {
        const coverData = await extract(bytes, coverEntry, 4 * 1024 * 1024);
        const cover = new Blob([new Uint8Array(coverData)], { type: mediaType! });
        book.color = await extractCoverColor(cover, book.color);
        return { book, cover };
      } catch { return { book, warning: 'Book details were imported. The embedded cover could not be read.' }; }
    }
    return { book };
  } catch {
    return { book, warning: 'The EPUB details could not be read. The original file can still be saved; please check its title and author.' };
  }
}
