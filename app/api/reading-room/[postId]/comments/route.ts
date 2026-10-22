import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { getOwnProfile } from '@/lib/server/profiles';
import { readingPostDto, reserveReadingAction } from '@/lib/server/journal';
import { readingRoomComments, readingRoomContext, readingRoomPost } from '@/lib/server/reading-room';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ postId: string }> };
const commentInput = z.object({ body: z.string().trim().min(1).max(4000), progress: z.number().min(0).max(100) });

export async function GET(request: Request, context: Context) { return handled(async () => {
  const user = await authenticated(request), { postId } = await context.params;
  const room = await readingRoomContext(user.userId, new URL(request.url).searchParams.get('bookId'));
  return json(await readingRoomComments(room, await readingRoomPost(room, postId)));
}); }

export async function POST(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request), { postId } = await context.params;
  const parsed = commentInput.safeParse(await readJson(request, 32768));
  if (!parsed.success) throw new HttpError(400, 'Write a reply of up to 4,000 characters and choose its place in the book.');
  const room = await readingRoomContext(user.userId, new URL(request.url).searchParams.get('bookId'));
  const post = await readingRoomPost(room, postId), parentProgress = readingPostDto(post).entry.progress;
  if (parsed.data.progress < parentProgress || parsed.data.progress > room.reader.progress) throw new HttpError(400, `Mark this reply between ${parentProgress}% and your saved bookmark at ${room.reader.progress}%.`);
  const profile = await getOwnProfile(user.userId), id = 'reply_' + crypto.randomUUID(), now = new Date().toISOString();
  await reserveReadingAction(user.userId, 'comment');
  const result = await database().prepare(`INSERT INTO reading_comments (id,post_id,owner_id,profile_id,name,body,progress,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id
      WHERE p.id = ? AND p.updated_at = ? AND p.book_key = ? AND CAST(json_extract(p.snapshot, '$.entry.progress') AS REAL) <= ?
        AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followed_owner_id = p.owner_id)))
    AND EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM public_profiles WHERE id = ? AND owner_id = ?))
    AND (SELECT COUNT(*) FROM reading_comments WHERE post_id = ?) < 100`)
    .bind(id, postId, user.userId, profile?.id ?? null, room.name || 'Reader', parsed.data.body, parsed.data.progress, now,
      postId, post.updated_at, room.key, parsed.data.progress, user.userId, user.userId, user.userId, room.version,
      profile?.id ?? null, profile?.id ?? null, user.userId, postId).run();
  if (!result.meta.changes) throw new HttpError(409, 'This conversation or your bookmark changed, or the conversation reached 100 replies. Refresh before replying.');
  return json({ comment: { id, name: room.name || 'Reader', body: parsed.data.body, progress: parsed.data.progress, createdAt: now, ...(profile ? { profileId: profile.id } : {}), canDelete: true } }, 201);
}); }
