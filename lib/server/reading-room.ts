import type { AppState, Book, ReadingComment } from '../types';
import type { ReadingRoomCommentsResponse, ReadingRoomOrder, ReadingRoomPosition, ReadingRoomResponse } from '../reading-room';
import { readingBookKey } from '../reading';
import { HttpError } from './http';
import { database, getLibrary } from './storage';
import { idSchema } from './validation';
import { readingPostDto, visibleCommentSql, type JoinedReadingPost } from './journal';

const PAGE_SIZE = 20;
const postProgress = "CAST(json_extract(p.snapshot, '$.entry.progress') AS REAL)";
const roomMembership = 'p.book_key = ? AND p.owner_id IN (SELECT followed_owner_id FROM follows WHERE follower_id = ? UNION SELECT ?)';

export interface ReadingRoomContext {
  ownerId: string;
  version: number;
  book: Book;
  key: string;
  reader: ReadingRoomPosition;
  name: string;
}

/** Index old, explicitly shared snapshots using exactly the same Unicode-aware
 * matcher as new posts. SQL lower() alone cannot correctly normalize these.
 * Each bounded pass uses two statements, regardless of the number of posts.
 * Conditional writes are safe beside a concurrent reshare or another request.
 */
export async function indexLegacyReadingPosts() {
  const db = database();
  for (let pass = 0; pass < 6; pass++) {
    const rows = await db.prepare("SELECT id,updated_at,json_extract(snapshot,'$.book.title') AS title,json_extract(snapshot,'$.book.author') AS author FROM reading_posts WHERE book_key = '' ORDER BY id LIMIT 500")
      .all<{ id: string; updated_at: string; title: string; author: string }>();
    if (!rows.results.length) return;
    const keys = rows.results.map(row => ({ id: row.id, updatedAt: row.updated_at, key: readingBookKey(row) }));
    await db.prepare("UPDATE reading_posts SET book_key = json_extract(k.value,'$.key') FROM json_each(?) AS k WHERE reading_posts.id = json_extract(k.value,'$.id') AND reading_posts.updated_at = json_extract(k.value,'$.updatedAt') AND reading_posts.book_key = ''")
      .bind(JSON.stringify(keys)).run();
    if (rows.results.length < 500) return;
  }
  const remaining = await db.prepare("SELECT 1 AS pending FROM reading_posts WHERE book_key = '' LIMIT 1").first();
  if (remaining) throw new HttpError(503, 'Earlier reading conversations are being prepared. Please try again in a moment.');
}

export async function readingRoomContext(ownerId: string, bookId: string | null): Promise<ReadingRoomContext> {
  if (!idSchema.safeParse(bookId).success) throw new HttpError(400, 'Choose a book from your Library.');
  const library = await getLibrary(ownerId);
  const state = library ? JSON.parse(library.state) as AppState : null;
  const book = state?.books.find(candidate => candidate.id === bookId);
  if (!library || !state || !book) throw new HttpError(404, 'This book is not in your saved Library. Save it before opening the reading room.');
  // Do not borrow the greatest progress from another edition. A reader may be
  // deliberately starting this copy again and expects its earlier boundary.
  const progress = book.status === 'read' ? 100 : Math.max(0, Math.min(100, Number.isFinite(book.progress) ? book.progress : 0));
  const reader: ReadingRoomPosition = { progress, ...(book.pages ? { page: Math.round(book.pages * progress / 100) } : {}) };
  return { ownerId, version: library.version, book, key: readingBookKey(book), reader, name: state.profile.name.slice(0, 80) };
}

interface RoomCursor { order: ReadingRoomOrder; bookId: string; ceiling: number; progress: number; date: string; id: string; }
function parseRoomCursor(value: string | null, room: ReadingRoomContext, order: ReadingRoomOrder): RoomCursor | undefined {
  if (!value) return;
  try {
    if (value.length > 1500) throw new Error();
    const decoded = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as RoomCursor;
    if (!decoded || decoded.order !== order || decoded.bookId !== room.book.id || decoded.ceiling !== room.reader.progress ||
      !Number.isFinite(decoded.progress) || decoded.progress < 0 || decoded.progress > room.reader.progress ||
      typeof decoded.date !== 'string' || decoded.date.length > 40 || !Number.isFinite(Date.parse(decoded.date)) ||
      !idSchema.safeParse(decoded.id).success) throw new Error();
    return decoded;
  } catch { throw new HttpError(400, 'This reading-room page is out of date. Refresh the conversation.'); }
}

function roomCursor(row: JoinedReadingPost, room: ReadingRoomContext, order: ReadingRoomOrder) {
  const progress = readingPostDto(row).entry.progress;
  return btoa(JSON.stringify({ order, bookId: room.book.id, ceiling: room.reader.progress, progress, date: row.published_at, id: row.id }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function readingRoom(ownerId: string, params: URLSearchParams): Promise<ReadingRoomResponse> {
  const order = params.get('order') ?? 'position';
  if (order !== 'position' && order !== 'newest') throw new HttpError(400, 'Choose reading order or newest first.');
  const room = await readingRoomContext(ownerId, params.get('bookId'));
  const cursor = parseRoomCursor(params.get('cursor'), room, order);
  await indexLegacyReadingPosts();
  const db = database(), scope = [room.key, ownerId, ownerId];
  const cursorSql = !cursor ? '' : order === 'newest'
    ? ' AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))'
    : ` AND (${postProgress} > ? OR (${postProgress} = ? AND (p.published_at > ? OR (p.published_at = ? AND p.id > ?))))`;
  const cursorBindings = !cursor ? [] : order === 'newest'
    ? [cursor.date, cursor.date, cursor.id]
    : [cursor.progress, cursor.progress, cursor.date, cursor.date, cursor.id];
  const sort = order === 'newest' ? 'p.published_at DESC,p.id DESC' : `${postProgress} ASC,p.published_at ASC,p.id ASC`;
  const results = await db.batch([
    db.prepare(`SELECT p.*,r.snapshot AS profile_snapshot,(SELECT COUNT(*) FROM reading_comments c WHERE c.post_id = p.id AND ${visibleCommentSql} AND c.progress <= ?) AS comment_count FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id WHERE ${roomMembership} AND ${postProgress} <= ?${cursorSql} ORDER BY ${sort} LIMIT ?`)
      .bind(room.reader.progress, ...scope, room.reader.progress, ...cursorBindings, PAGE_SIZE + 1),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN ${postProgress} <= ? THEN 1 ELSE 0 END),0) AS visible,COALESCE(SUM(CASE WHEN ${postProgress} > ? THEN 1 ELSE 0 END),0) AS waiting FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id WHERE ${roomMembership}`)
      .bind(room.reader.progress, room.reader.progress, ...scope),
    db.prepare('SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?').bind(ownerId),
    db.prepare('SELECT version FROM libraries WHERE owner_id = ?').bind(ownerId),
  ]);
  if ((results[3].results[0] as { version?: number } | undefined)?.version !== room.version) throw new HttpError(409, 'Your bookmark changed. Refresh to open the conversation at your saved place.');
  const rows = results[0].results as unknown as JoinedReadingPost[];
  const counts = results[1].results[0] as { visible: number; waiting: number };
  const following = results[2].results[0] as { count: number };
  const items = rows.slice(0, PAGE_SIZE);
  return {
    items: items.map(readingPostDto), reader: room.reader, followingCount: following.count,
    totalVisible: counts.visible, waitingCount: counts.waiting,
    ...(rows.length > PAGE_SIZE ? { nextCursor: roomCursor(items[items.length - 1], room, order) } : {}),
  };
}

export async function readingRoomPost(room: ReadingRoomContext, postId: string): Promise<JoinedReadingPost> {
  if (!idSchema.safeParse(postId).success) throw new HttpError(404, 'This conversation is not available at your bookmark.');
  await indexLegacyReadingPosts();
  const post = await database().prepare(`SELECT p.*,r.snapshot AS profile_snapshot,0 AS comment_count FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id WHERE p.id = ? AND ${roomMembership} AND ${postProgress} <= ?`)
    .bind(postId, room.key, room.ownerId, room.ownerId, room.reader.progress).first<JoinedReadingPost>();
  if (!post) throw new HttpError(404, 'This conversation is not available at your bookmark.');
  return post;
}

export async function readingRoomComments(room: ReadingRoomContext, post: JoinedReadingPost): Promise<ReadingRoomCommentsResponse> {
  const parentProgress = readingPostDto(post).entry.progress;
  const results = await database().batch([
    database().prepare(`SELECT c.id,c.owner_id,c.profile_id,c.name,c.body,c.progress,c.created_at FROM reading_comments c WHERE c.post_id = ? AND ${visibleCommentSql} AND c.progress <= ? ORDER BY c.created_at ASC,c.id ASC LIMIT 100`)
      .bind(post.id, room.reader.progress),
    database().prepare(`SELECT COUNT(*) AS count FROM reading_comments c WHERE c.post_id = ? AND ${visibleCommentSql} AND c.progress > ?`).bind(post.id, room.reader.progress),
    database().prepare('SELECT version FROM libraries WHERE owner_id = ?').bind(room.ownerId),
    database().prepare(`SELECT p.id FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id WHERE p.id = ? AND p.updated_at = ? AND ${roomMembership} AND ${postProgress} <= ?`)
      .bind(post.id, post.updated_at, room.key, room.ownerId, room.ownerId, room.reader.progress),
  ]);
  if ((results[2].results[0] as { version?: number } | undefined)?.version !== room.version || !results[3].results.length) throw new HttpError(409, 'This conversation or your bookmark changed. Refresh before continuing.');
  const rows = results[0].results as unknown as { id: string; owner_id: string; profile_id: string | null; name: string; body: string; progress: number; created_at: string }[];
  const comments: ReadingComment[] = rows.map(row => ({
    id: row.id, name: row.name, body: row.body, progress: Math.max(parentProgress, row.progress), createdAt: row.created_at,
    ...(row.profile_id ? { profileId: row.profile_id } : {}), canDelete: row.owner_id === room.ownerId || post.owner_id === room.ownerId,
  }));
  return { comments, reader: room.reader, waitingCount: (results[1].results[0] as { count: number }).count };
}
