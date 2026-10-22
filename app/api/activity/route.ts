import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database, getLibrary } from '@/lib/server/storage';
import { getOwnProfile } from '@/lib/server/profiles';
import { activityBook, parseFeedCursor, type ReaderActivityRow } from '@/lib/server/feed';
import { idSchema } from '@/lib/server/validation';
import type { ActivityEvent, AppState, PublicBook, PublicProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request), db = database();
  const cursor = parseFeedCursor(new URL(request.url).searchParams.get('cursor'));
  if (cursor && !cursor[1].startsWith('activity:')) throw new HttpError(400, 'Invalid update page.');
  const statement = db.prepare(`SELECT * FROM reader_activity WHERE owner_id=? ${cursor ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT 21`);
  const [rows, profile] = await Promise.all([
    (cursor ? statement.bind(user.userId, cursor[0], cursor[0], cursor[1].slice('activity:'.length)) : statement.bind(user.userId)).all<ReaderActivityRow>(),
    getOwnProfile(user.userId),
  ]);
  const page = rows.results.slice(0, 20), last = page.at(-1);
  const items: ActivityEvent[] = page.map(row => ({ id: row.id, kind: row.kind, createdAt: row.created_at,
    actor: { id: row.profile_id, name: profile ? (JSON.parse(profile.snapshot) as PublicProfile).name : 'You' }, book: JSON.parse(row.snapshot) as PublicBook }));
  return json({ items, ...(rows.results.length > 20 && last ? { nextCursor: btoa(JSON.stringify([last.created_at, 'activity:' + last.id])) } : {}) });
}); }
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const body = await readJson(request, 2048) as { kind?: unknown; bookId?: unknown };
  if (!body || !['purchased', 'added'].includes(String(body.kind)) || !idSchema.safeParse(body.bookId).success) throw new HttpError(400, 'Choose the book and update you want to share.');
  const [profile, library] = await Promise.all([getOwnProfile(user.userId), getLibrary(user.userId)]);
  if (!profile) throw new HttpError(409, 'Publish your profile before sharing an update.');
  if (!library) throw new HttpError(404, 'Save your library before sharing an update.');
  const book = (JSON.parse(library.state) as AppState).books.find(item => item.id === body.bookId);
  if (!book) throw new HttpError(404, 'This book is no longer in your saved library.');
  const id = 'act_' + crypto.randomUUID(), now = new Date().toISOString(), since = new Date(Date.now() - 3600000).toISOString();
  const snapshot = activityBook(book);
  const result = await database().prepare(`INSERT INTO reader_activity (id,owner_id,profile_id,kind,book_id,snapshot,created_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM reader_activity WHERE owner_id=? AND created_at>?)<24
      AND (SELECT COUNT(*) FROM reader_activity WHERE owner_id=?)<2000
      AND EXISTS(SELECT 1 FROM public_profiles WHERE id=? AND owner_id=?)
      AND EXISTS(SELECT 1 FROM libraries WHERE owner_id=? AND version=?)`)
    .bind(id, user.userId, profile.id, body.kind, book.id, JSON.stringify(snapshot), now, user.userId, since, user.userId, profile.id, user.userId, user.userId, library.version).run();
  if (!result.meta.changes) throw new HttpError(409, 'Your library or profile changed, or you reached the update limit. Refresh and try again later.');
  const event: ActivityEvent = { id, kind: body.kind as 'purchased' | 'added', createdAt: now,
    actor: { id: profile.id, name: (JSON.parse(profile.snapshot) as PublicProfile).name }, book: snapshot };
  return json({ item: event }, 201);
}); }
