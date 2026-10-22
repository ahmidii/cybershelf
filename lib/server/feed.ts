import type { ActivityEvent, Book, PublicBook, Publication } from '../types';
import { HttpError } from './http';
import { database } from './storage';

export interface FollowingReader { id: string; name: string; bio: string; unavailable?: boolean; }
export interface ReaderActivityRow { id: string; owner_id: string; profile_id: string; kind: 'purchased' | 'added'; book_id: string; snapshot: string; created_at: string; }
interface FeedRow {
  key: string; id: string; kind: ActivityEvent['kind']; created_at: string; actor_id: string; actor_name: string;
  book_json: string | null; progress: number | null; body: string | null; post_id: string | null; shelf_json: string | null; comment_id: string | null;
}
export function parseFeedCursor(cursor: string | null): [string, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 500) throw new Error('Long cursor');
    const value: unknown = JSON.parse(atob(cursor));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && value[0].length <= 40 && Number.isFinite(Date.parse(value[0])) &&
      typeof value[1] === 'string' && /^(reading|comment|shelf|activity):[A-Za-z0-9_-]{1,100}$/.test(value[1])) return [value[0], value[1]];
  } catch { /* Produce the same bounded error for malformed cursors. */ }
  throw new HttpError(400, 'This feed page has expired. Refresh your feed.');
}

export async function followingReaders(ownerId: string): Promise<FollowingReader[]> {
  const rows = await database().prepare(`SELECT COALESCE(p.id,f.followed_profile_id) AS id,
    CASE WHEN p.id IS NULL THEN 'Unavailable profile' ELSE json_extract(p.snapshot,'$.name') END AS name,
    CASE WHEN p.id IS NULL THEN '' ELSE json_extract(p.snapshot,'$.bio') END AS bio,
    CASE WHEN p.id IS NULL THEN 1 ELSE 0 END AS unavailable
    FROM follows f LEFT JOIN public_profiles p ON p.owner_id=f.followed_owner_id
    WHERE f.follower_id=? ORDER BY f.created_at DESC,f.followed_profile_id DESC LIMIT 500`).bind(ownerId)
    .all<{ id: string; name: string; bio: string; unavailable: number }>();
  return rows.results.map(row => ({ id: row.id, name: row.name, bio: row.bio, ...(row.unavailable ? { unavailable: true } : {}) }));
}

/** One bounded UNION query. Every branch starts from followed, currently
 * public identities. Reading posts/comments additionally retain their exact
 * published identity, so unpublishing and republishing cannot revive them. */
export async function followingFeed(ownerId: string, cursor: [string, string] | null) {
  const query = `WITH followed AS (
    SELECT p.owner_id,p.id,json_extract(p.snapshot,'$.name') AS name
    FROM follows f JOIN public_profiles p ON p.owner_id=f.followed_owner_id WHERE f.follower_id=?
  ), visible_posts AS (
    SELECT r.* FROM reading_posts r JOIN public_profiles p ON p.id=r.profile_id AND p.owner_id=r.owner_id
  ), activity AS (
    SELECT 'reading:'||r.id AS key,r.id,'reading' AS kind,r.updated_at AS created_at,f.id AS actor_id,f.name AS actor_name,
      json_extract(r.snapshot,'$.book') AS book_json,CAST(json_extract(r.snapshot,'$.entry.progress') AS REAL) AS progress,
      json_extract(r.snapshot,'$.entry.body') AS body,r.id AS post_id,NULL AS shelf_json,NULL AS comment_id
      FROM visible_posts r JOIN followed f ON f.owner_id=r.owner_id AND f.id=r.profile_id
    UNION ALL
    SELECT 'comment:'||c.id,c.id,'comment',c.created_at,f.id,f.name,
      json_extract(r.snapshot,'$.book'),MAX(CAST(json_extract(r.snapshot,'$.entry.progress') AS REAL),c.progress),
      c.body,r.id,NULL,c.id FROM reading_comments c
      JOIN followed f ON f.owner_id=c.owner_id AND f.id=c.profile_id JOIN visible_posts r ON r.id=c.post_id
    UNION ALL
    SELECT 'shelf:'||p.id,p.id,CASE WHEN p.updated_at>p.published_at THEN 'shelf_updated' ELSE 'shelf' END,p.updated_at,f.id,f.name,
      NULL,NULL,NULL,NULL,p.snapshot,NULL FROM publications p JOIN followed f ON f.owner_id=p.owner_id
    UNION ALL
    SELECT 'activity:'||a.id,a.id,a.kind,a.created_at,f.id,f.name,a.snapshot,NULL,NULL,NULL,NULL,NULL
      FROM reader_activity a JOIN followed f ON f.owner_id=a.owner_id AND f.id=a.profile_id
  ) SELECT * FROM activity ${cursor ? 'WHERE created_at<? OR (created_at=? AND key<?)' : ''}
    ORDER BY created_at DESC,key DESC LIMIT 31`;
  const statement = database().prepare(query);
  const result = await (cursor ? statement.bind(ownerId, cursor[0], cursor[0], cursor[1]) : statement.bind(ownerId)).all<FeedRow>();
  const rows = result.results.slice(0, 30), last = rows.at(-1);
  const count = await database().prepare('SELECT COUNT(*) AS total FROM follows WHERE follower_id=?').bind(ownerId).first<{ total: number }>();
  return { items: rows.map(activityDTO), followingCount: count?.total ?? 0,
    ...(result.results.length > 30 && last ? { nextCursor: btoa(JSON.stringify([last.created_at, last.key])) } : {}) };
}
function activityDTO(row: FeedRow): ActivityEvent {
  return { id: row.id, kind: row.kind, createdAt: row.created_at, actor: { id: row.actor_id, name: row.actor_name },
    ...(row.book_json ? { book: JSON.parse(row.book_json) as PublicBook } : {}),
    ...(row.progress !== null ? { progress: row.progress } : {}),
    ...(row.body !== null ? { body: row.body } : {}), ...(row.post_id ? { postId: row.post_id } : {}),
    ...(row.comment_id ? { commentId: row.comment_id } : {}),
    ...(row.shelf_json ? { shelf: { ...JSON.parse(row.shelf_json) as Publication, profileId: row.actor_id } } : {}),
  };
}

/** Acquisition announcements do not grant a new public file URL. Uploaded
 * artwork stays private here and uses its typographic fallback in the feed. */
export function activityBook(book: Book): PublicBook {
  const image = (value: string | undefined) => {
    try {
      const url = new URL(value ?? '');
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !/^\/api\/(?:assets|profiles|reading)(?:\/|$)/.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  };
  return { id: book.id, title: book.title, author: book.author, color: book.color, coverUrl: image(book.coverUrl),
    ...(book.spineUrl && image(book.spineUrl) ? { spineUrl: image(book.spineUrl) } : {}),
    ...(book.pages !== undefined ? { pages: book.pages } : {}), ...(book.format ? { format: book.format } : {}),
    ...(book.dimensions ? { dimensions: { heightMm: book.dimensions.heightMm, widthMm: book.dimensions.widthMm, thicknessMm: book.dimensions.thicknessMm, source: book.dimensions.source } } : {}),
  };
}
