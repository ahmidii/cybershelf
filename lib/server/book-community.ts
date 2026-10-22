import type { CatalogBook } from '../book-catalog';
import { normalizeCatalogId } from '../book-catalog';
import type { BookCommunityMutationResponse, BookCommunityResponse, CommunityRead, MyBookCommunity } from '../book-community';
import type { AppState } from '../types';
import { readingBookKey } from '../reading';
import { lookupCatalogWork } from './book-catalog';
import { database, getLibrary } from './storage';
import { HttpError } from './http';
import { reserveReadingAction } from './journal';
import { indexLegacyReadingPosts } from './reading-room';

interface CommunityBookRow { id: string; title: string; author: string; created_at: string; }
interface CommunityScope { id: string; legacyKey?: string; }

export async function readCommunityCatalogBook(id: string): Promise<CatalogBook | null> {
  if (!/^cs_[a-f0-9]{64}$/.test(id)) return null;
  const row = await database().prepare('SELECT id,title,author,created_at FROM community_books WHERE id = ?').bind(id).first<CommunityBookRow>();
  return row ? {
    id: row.id, source: 'community', title: row.title, author: row.author,
    authors: row.author ? [row.author] : [], description: '', coverUrl: '', subjects: [],
    editions: [], editionCount: 0, editionsOffset: 0, nextEditionsOffset: null,
  } : null;
}

/** A deliberate, minimal publication. It neither changes the private book nor
 * copies private cover URLs, uploaded artwork, notes, ratings or source links. */
export async function registerCommunityBook(ownerId: string, localBookId: string): Promise<CatalogBook> {
  const library = await getLibrary(ownerId);
  const book = library ? (JSON.parse(library.state) as AppState).books.find(item => item.id === localBookId) : undefined;
  if (!library || !book) throw new HttpError(404, 'This book is not in your saved Library. Save it before creating its page.');
  if (book.catalogId?.startsWith('OL')) throw new HttpError(409, 'This book already has an Open Library page. Open that page instead.');
  const title = book.title.trim(), author = book.author.trim();
  if (!title) throw new HttpError(400, 'Give this book a title before creating its page.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(readingBookKey({ title, author })));
  const id = 'cs_' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  await reserveReadingAction(ownerId, 'catalog');
  const db = database();
  const results = await db.batch([
    db.prepare('INSERT INTO community_books (id,title,author,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?) ON CONFLICT(id) DO NOTHING')
      .bind(id, title, author, new Date().toISOString(), ownerId, library.version),
    db.prepare('SELECT version FROM libraries WHERE owner_id = ?').bind(ownerId),
  ]);
  if ((results[1].results[0] as { version?: number } | undefined)?.version !== library.version) throw new HttpError(409, 'Your Library changed while creating the page. Save your changes and try again.');
  const registered = await readCommunityCatalogBook(id);
  if (!registered) throw new HttpError(409, 'The book page could not be created. Please try again.');
  return registered;
}

async function communityScope(value: string): Promise<CommunityScope> {
  const id = normalizeCatalogId(value);
  if (!id || id !== value) throw new HttpError(404, 'This book page is not available.');
  if (!id.startsWith('cs_')) return { id };
  const book = await readCommunityCatalogBook(id);
  if (!book) throw new HttpError(404, 'This community book page is not available.');
  // Only legacy public snapshots can use a text fallback. A post explicitly
  // assigned to another catalog work is never pulled into this community page.
  await indexLegacyReadingPosts();
  return { id, legacyKey: readingBookKey(book) };
}

async function requireExistingCatalogWork(scope: CommunityScope) {
  if (!scope.id.startsWith('cs_') && !await lookupCatalogWork(scope.id)) throw new HttpError(404, 'This book is no longer available in the catalog.');
}

function sharedCompletions(scope: CommunityScope, ownerId?: string) {
  const identity = scope.legacyKey === undefined ? 'p.catalog_id = ?' : '(p.catalog_id = ? OR (p.catalog_id IS NULL AND p.book_key = ?))';
  const bindings = scope.legacyKey === undefined ? [scope.id] : [scope.id, scope.legacyKey];
  if (ownerId) bindings.push(ownerId);
  return {
    sql: `SELECT p.owner_id FROM reading_posts p
      JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id
      JOIN auth_user u ON u.id = p.owner_id
      WHERE ${identity} AND json_type(p.snapshot,'$.entry.progress') IN ('integer','real')
      AND json_extract(p.snapshot,'$.entry.progress') = 100${ownerId ? ' AND p.owner_id = ?' : ''}
      GROUP BY p.owner_id`,
    bindings,
  };
}

/** Counts come exclusively from explicit community contributions and live,
 * shared completion posts. This query never touches libraries.state. Several
 * final thoughts establish one read; deliberate dated rereads can add more. */
async function communitySnapshot(scope: CommunityScope, ownerId?: string): Promise<BookCommunityResponse | BookCommunityMutationResponse> {
  const db = database(), shared = sharedCompletions(scope);
  const statements = [
    db.prepare('SELECT AVG(rating) AS average_rating,COUNT(*) AS rating_count FROM book_ratings WHERE catalog_id = ?').bind(scope.id),
    db.prepare(`WITH contributions AS (
      SELECT owner_id,COUNT(*) AS reads FROM book_reads WHERE catalog_id = ? GROUP BY owner_id
      UNION ALL SELECT owner_id,1 AS reads FROM (${shared.sql})
    ), per_reader AS (SELECT owner_id,MAX(reads) AS reads FROM contributions GROUP BY owner_id)
    SELECT COALESCE(SUM(reads),0) AS read_count,COUNT(*) AS reader_count FROM per_reader`)
      .bind(scope.id, ...shared.bindings),
  ];
  if (ownerId) {
    const ownShared = sharedCompletions(scope, ownerId);
    statements.push(
      db.prepare('SELECT rating FROM book_ratings WHERE owner_id = ? AND catalog_id = ?').bind(ownerId, scope.id),
      db.prepare('SELECT id,finished_at FROM book_reads WHERE owner_id = ? AND catalog_id = ? ORDER BY finished_at DESC,id DESC LIMIT 200').bind(ownerId, scope.id),
      db.prepare(ownShared.sql).bind(...ownShared.bindings),
    );
  }
  const results = await db.batch(statements);
  const ratings = results[0].results[0] as { average_rating: number | null; rating_count: number };
  const reads = results[1].results[0] as { read_count: number; reader_count: number };
  const stats = { averageRating: ratings.average_rating, ratingCount: ratings.rating_count, readCount: reads.read_count, readerCount: reads.reader_count };
  if (!ownerId) return { stats };
  const ownReads = results[3].results as unknown as { id: string; finished_at: string }[];
  return { stats, mine: {
    rating: (results[2].results[0] as { rating: number } | undefined)?.rating ?? null,
    reads: ownReads.map(row => ({ id: row.id, finishedAt: row.finished_at })),
    hasSharedCompletion: results[4].results.length > 0,
  } };
}

export async function bookCommunity(id: string): Promise<BookCommunityResponse> {
  return communitySnapshot(await communityScope(id));
}

export async function myBookCommunity(id: string, ownerId: string): Promise<MyBookCommunity> {
  return ((await communitySnapshot(await communityScope(id), ownerId)) as BookCommunityMutationResponse).mine;
}

export async function setCommunityRating(id: string, ownerId: string, rating: number | null): Promise<BookCommunityMutationResponse> {
  const scope = await communityScope(id), db = database();
  if (rating === null) {
    await db.prepare('DELETE FROM book_ratings WHERE owner_id = ? AND catalog_id = ?').bind(ownerId, scope.id).run();
  } else {
    const prior=await db.prepare('SELECT rating FROM book_ratings WHERE owner_id = ? AND catalog_id = ?').bind(ownerId,scope.id).first<{rating:number}>();
    if(prior?.rating===rating)return await communitySnapshot(scope,ownerId) as BookCommunityMutationResponse;
    // Charge attempts before external lookups, including unknown work IDs.
    // Replaying an already saved value needs neither the catalog nor a quota.
    await reserveReadingAction(ownerId, 'rating');
    await requireExistingCatalogWork(scope);
    const now = new Date().toISOString();
    const result = await db.prepare(`INSERT INTO book_ratings (owner_id,catalog_id,rating,created_at,updated_at)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM book_ratings WHERE owner_id = ? AND catalog_id = ?)
      OR (SELECT COUNT(*) FROM book_ratings WHERE owner_id = ?) < 2000
      ON CONFLICT(owner_id,catalog_id) DO UPDATE SET rating = excluded.rating,updated_at = excluded.updated_at`)
      .bind(ownerId, scope.id, rating, now, now, ownerId, scope.id, ownerId).run();
    if (!result.meta.changes) throw new HttpError(409, 'You can share up to 2,000 community ratings. Remove a rating to make room.');
  }
  return await communitySnapshot(scope, ownerId) as BookCommunityMutationResponse;
}

export async function addCommunityRead(id: string, ownerId: string, read: CommunityRead): Promise<{ created: boolean; response: BookCommunityMutationResponse }> {
  const scope = await communityScope(id), db = database();
  const prior = await db.prepare('SELECT catalog_id,finished_at FROM book_reads WHERE owner_id = ? AND id = ?').bind(ownerId, read.id).first<{ catalog_id: string; finished_at: string }>();
  if (prior && (prior.catalog_id !== scope.id || prior.finished_at !== read.finishedAt)) throw new HttpError(409, 'This read was already saved for a different book or date. Refresh before logging another read.');
  const sameDay=prior??await db.prepare('SELECT id FROM book_reads WHERE owner_id = ? AND catalog_id = ? AND finished_at = ?').bind(ownerId,scope.id,read.finishedAt).first();
  if(sameDay)return {created:false,response:await communitySnapshot(scope,ownerId) as BookCommunityMutationResponse};
  await reserveReadingAction(ownerId, 'read');
  await requireExistingCatalogWork(scope);
  const result = await db.prepare(`INSERT INTO book_reads (owner_id,id,catalog_id,finished_at,created_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM book_reads WHERE owner_id = ?) < 2000
    AND (SELECT COUNT(*) FROM book_reads WHERE owner_id = ? AND catalog_id = ?) < 200
    ON CONFLICT DO NOTHING`)
    .bind(ownerId, read.id, scope.id, read.finishedAt, new Date().toISOString(), ownerId, ownerId, scope.id).run();
  // Recheck the id after INSERT too: another tab may have claimed this id for
  // a different date between the preflight read and the atomic write.
  const saved = await db.prepare('SELECT catalog_id,finished_at FROM book_reads WHERE owner_id = ? AND id = ?').bind(ownerId, read.id).first<{ catalog_id: string; finished_at: string }>();
  if (saved && (saved.catalog_id !== scope.id || saved.finished_at !== read.finishedAt)) throw new HttpError(409, 'This read was already saved for a different book or date. Refresh before logging another read.');
  if (!result.meta.changes && !saved) {
    const duplicate = await db.prepare('SELECT id FROM book_reads WHERE owner_id = ? AND catalog_id = ? AND finished_at = ?').bind(ownerId, scope.id, read.finishedAt).first();
    if (!duplicate) throw new HttpError(409, 'You can log up to 200 reads per book and 2,000 reads in total. Remove an old log to make room.');
  }
  return { created: !!result.meta.changes, response: await communitySnapshot(scope, ownerId) as BookCommunityMutationResponse };
}

export async function deleteCommunityRead(id: string, ownerId: string, readId: string): Promise<BookCommunityMutationResponse> {
  const scope = await communityScope(id);
  // Retrying a removal is safe; a different account's identical read ID cannot
  // be removed and is not revealed by a different status or response body.
  await database().prepare('DELETE FROM book_reads WHERE owner_id = ? AND catalog_id = ? AND id = ?').bind(ownerId, scope.id, readId).run();
  return await communitySnapshot(scope, ownerId) as BookCommunityMutationResponse;
}
