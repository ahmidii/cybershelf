import type { AppState, Book, BookConnectionRecord, ImportedBookFields, LibraryConnection, ReadingStatus } from './types';
import { newBook, uid } from './types';
import { bookColor } from './import';
import { normalizeBookISBN } from './book-size';
import { readingBookKey } from './reading';
import { pageCountPatch } from './reading-progress';
import { spineEditionChanged } from './spine-image';

export interface RemoteBook {
  remoteId: string; title: string; author: string; coverUrl: string; url: string;
  isbn?: string; pages?: number; owned?: boolean; status?: ReadingStatus;
  progress?: number; rating?: number | null; updatedAt?: string;
}
export interface SyncSummary { added: number; updated: number; preserved: number; }
export interface ConnectionSyncResult { state: AppState; summary: SyncSummary; }

const catalogFields = ['title', 'author', 'coverUrl', 'isbn', 'pages', 'rating'] as const;
const readingFields = ['status', 'progress'] as const;
const hasValue = (value: unknown) => value !== undefined && value !== '' && value !== null;

function editionKey(value: string | undefined): string | undefined {
  const isbn = normalizeBookISBN(value);
  if (!isbn || isbn.length === 13) return isbn;
  const prefix = '978' + isbn.slice(0, 9);
  const total = [...prefix].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
  return prefix + String((10 - total % 10) % 10);
}

function importedBaseline(previous: ImportedBookFields | undefined): ImportedBookFields {
  const result: ImportedBookFields = {};
  for (const key of [...catalogFields, ...readingFields]) {
    if (previous?.[key] !== undefined) Object.assign(result, { [key]: previous[key] });
  }
  return result;
}

function snapshot(remote: RemoteBook, syncProgress: boolean): ImportedBookFields {
  const result: ImportedBookFields = {};
  for (const key of catalogFields) {
    const value = remote[key];
    // Incomplete provider metadata must not erase a known edition or cover.
    if (value !== undefined && value !== '') Object.assign(result, { [key]: value });
  }
  if (syncProgress) for (const key of readingFields) {
    if (remote[key] !== undefined) Object.assign(result, { [key]: remote[key] });
  }
  return result;
}

function findMatch(books: Book[], remote: RemoteBook, connectionId: string): Book | undefined {
  const linked = books.find(book => book.connections?.some(link => link.connectionId === connectionId && link.remoteId === remote.remoteId));
  if (linked) return linked;
  const isbn = editionKey(remote.isbn);
  const sameEdition = isbn ? books.filter(book => editionKey(book.isbn) === isbn) : [];
  if (sameEdition.length === 1) return sameEdition[0];
  if (sameEdition.length > 1) return undefined;
  const key = readingBookKey(remote);
  const matching = books.filter(book => readingBookKey(book) === key && (!isbn || !editionKey(book.isbn)));
  // Distinct ISBNs and ambiguous matches are separate books, never guesses.
  return matching.length === 1 ? matching[0] : undefined;
}

/** A three-way import. Existing edits always win a conflict. No remote deletion
 * removes a local book, shelf placement, file, journal entry, or public post. */
export function syncConnection(state: AppState, connection: LibraryConnection, incoming: RemoteBook[], now = new Date().toISOString()): ConnectionSyncResult {
  if (incoming.length > 2000) throw new Error('Connect up to 2,000 books at a time. Your current library has not changed.');
  const connections = state.connections ?? [];
  if (connections.some(item => item.id === connection.id && item.accountKey !== connection.accountKey)) throw new Error('This connection belongs to a different provider account. Reconnect it before syncing.');
  if (connections.some(item => item.accountKey === connection.accountKey && item.id !== connection.id)) throw new Error('This account is already connected. Reconnect the existing connection to continue.');
  if (!connections.some(item => item.id === connection.id) && connections.length >= 10) throw new Error('You can connect up to 10 accounts. Disconnect one to make room.');
  const books = [...state.books], summary: SyncSummary = { added: 0, updated: 0, preserved: 0 };
  const ids = new Set<string>();
  for (const remote of incoming) {
    if (!remote.remoteId || !remote.title.trim()) throw new Error('A book from this account is incomplete. Your current library has not changed.');
    if (ids.has(remote.remoteId)) continue;
    ids.add(remote.remoteId);
    const existing = findMatch(books, remote, connection.id);
    if (!existing && books.length >= 2000) throw new Error('Your library would exceed 2,000 books. Nothing from this sync has been applied.');
    const nextFields = snapshot(remote, connection.syncProgress);
    const previous = existing?.connections?.find(link => link.connectionId === connection.id && link.remoteId === remote.remoteId);
    let book: Book = existing ? { ...existing } : { ...newBook(remote.title, remote.author), color: bookColor(remote.title + remote.author) };
    let changed = false, preserved = false;
    const accepted = importedBaseline(previous?.lastImported);
    // Check provenance before a corrected page count recalculates the local
    // fraction. An explicit provider bookmark remains an atomic pair.
    const tracked = previous?.lastImported;
    const untouchedBookmark = tracked && tracked.status !== undefined && tracked.progress !== undefined
      ? book.status === tracked.status && book.progress === tracked.progress
      : existing && book.status === 'unread' && book.progress === 0 && !book.readingLog?.length && !book.finishedAt && book.currentPage === undefined;
    for (const key of Object.keys(nextFields).filter(key => key !== 'status' && key !== 'progress') as (keyof ImportedBookFields)[]) {
      const value = nextFields[key], local = book[key], base = previous?.lastImported[key];
      // At first connection, only fill missing fields on an existing record.
      // A later change is accepted only while the local field still matches
      // the last value that this connector actually imported.
      const missing = !hasValue(local) && (!previous || base === undefined);
      const mayUpdate = !existing || missing || previous && base !== undefined && local === base;
      if (mayUpdate) {
        if (local !== value) {
          Object.assign(book, key === 'pages' ? pageCountPatch(book, value as number) : { [key]: value });
          changed = true;
        }
        Object.assign(accepted, { [key]: value });
      } else if (local === value) {
        Object.assign(accepted, { [key]: value });
      } else if (value !== base) preserved = true;
    }
    if (existing && spineEditionChanged(existing, book)) {
      // An image and a numbered page describe one physical edition. Retain
      // reading history, but never carry that artwork/bookmark to a new ISBN.
      book.spineUrl = undefined; book.currentPage = undefined;
      book.catalogId = undefined; book.editionId = undefined;
      book.progress = existing.progress; book.status = existing.status; book.finishedAt = existing.finishedAt;
      if (book.dimensions?.source !== 'manual') book.dimensions = undefined;
    }
    if (connection.syncProgress && nextFields.status !== undefined && nextFields.progress !== undefined) {
      const nextStatus = nextFields.status, nextProgress = nextFields.progress;
      // Status and progress form one bookmark. Updating them separately could
      // mark a locally edited reread finished and unexpectedly expose spoilers.
      if (!existing || untouchedBookmark) {
        if (book.status !== nextStatus || book.progress !== nextProgress) {
          changed = true;
          book.currentPage = undefined;
        }
        book.status = nextStatus; book.progress = nextProgress;
        accepted.status = nextStatus; accepted.progress = nextProgress;
      } else if (book.status === nextStatus && book.progress === nextProgress) {
        accepted.status = nextStatus; accepted.progress = nextProgress;
      } else preserved = true;
    }
    // An incomplete provider bookmark never borrows a local percentage: doing
    // so could turn a provider reread into "reading, 100%" and expose its ending.
    // Retain the last accepted pair while sync is off. Opting back in can then
    // resume an unchanged bookmark while still detecting edits made meanwhile.
    // Optional fields cleared by reconciliation must also round-trip through
    // JSON backups, which omit undefined object properties.
    for (const key of ['currentPage', 'spineUrl', 'catalogId', 'editionId', 'dimensions', 'finishedAt'] as const) {
      if (book[key] === undefined) delete book[key];
    }
    const sourceId = previous?.sourceId ?? uid('src_');
    const label = remote.owned ? 'Hardcover · marked owned' : 'Hardcover';
    const source = { id: sourceId, kind: 'link' as const, label, url: remote.url };
    const sources = book.sources.map(item => item.id === sourceId ? source : item);
    if (!sources.some(item => item.id === sourceId)) {
      if (sources.length >= 30) throw new Error('A book already has 30 sources. Remove an unused source before connecting this account.');
      sources.push(source);
    }
    const record: BookConnectionRecord = { connectionId: connection.id, remoteId: remote.remoteId, sourceId, lastImported: accepted };
    const links = (book.connections ?? []).filter(link => !(link.connectionId === connection.id && link.remoteId === remote.remoteId));
    if (links.length >= 20) throw new Error('A book is already linked to 20 account records. Disconnect an unused account first.');
    book = { ...book, sources, connections: [...links, record] };
    if (existing) books[books.findIndex(item => item.id === existing.id)] = book;
    else books.push(book);
    if (!existing) summary.added++;
    else if (changed) summary.updated++;
    if (preserved) summary.preserved++;
  }
  const saved: LibraryConnection = {
    id: connection.id, provider: connection.provider, accountKey: connection.accountKey,
    label: connection.label, autoSync: connection.autoSync, syncProgress: connection.syncProgress,
    connectedAt: connection.connectedAt, lastSyncedAt: now, lastSummary: summary,
  };
  return { state: { ...state, books, connections: connections.some(item => item.id === saved.id) ? connections.map(item => item.id === saved.id ? saved : item) : [...connections, saved] }, summary };
}

export function disconnectConnection(state: AppState, id: string): AppState {
  return { ...state, connections: state.connections?.filter(connection => connection.id !== id), books: state.books.map(book => {
    if (!book.connections?.some(link => link.connectionId === id)) return book;
    const connections = book.connections.filter(link => link.connectionId !== id);
    return { ...book, connections: connections.length ? connections : undefined };
  }) };
}

/** An opaque matching fingerprint; this is pseudonymisation, not encryption.
 * No username, email, provider password, or token is saved in library state. */
export async function connectionAccountKey(accountId: string, providerKey: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hardcover:${accountId}:${providerKey}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
