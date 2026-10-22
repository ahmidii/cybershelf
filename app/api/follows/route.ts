import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { getOwnProfile } from '@/lib/server/profiles';
import { followingReaders } from '@/lib/server/feed';
import { idSchema } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request);
  const [following, profile] = await Promise.all([followingReaders(user.userId), getOwnProfile(user.userId)]);
  return json({ following, accountId: user.userId, ...(profile ? { ownProfileId: profile.id } : {}) });
}); }
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const body = await readJson(request, 2048) as { profileId?: unknown };
  const parsed = idSchema.safeParse(body?.profileId);
  if (!parsed.success) throw new HttpError(400, 'Choose a public reader to follow.');
  const db = database(), profile = await db.prepare('SELECT id,owner_id FROM public_profiles WHERE id=?').bind(parsed.data).first<{ id: string; owner_id: string }>();
  if (!profile) throw new HttpError(404, 'This profile is no longer public.');
  if (profile.owner_id === user.userId) throw new HttpError(400, 'This is your own profile.');
  const result = await db.prepare(`INSERT INTO follows (follower_id,followed_owner_id,followed_profile_id,created_at)
    SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM follows WHERE follower_id=?)<500
      OR EXISTS(SELECT 1 FROM follows WHERE follower_id=? AND followed_owner_id=?)
    ON CONFLICT(follower_id,followed_owner_id) DO UPDATE SET followed_profile_id=excluded.followed_profile_id`)
    .bind(user.userId, profile.owner_id, profile.id, new Date().toISOString(), user.userId, user.userId, profile.owner_id).run();
  if (!result.meta.changes) throw new HttpError(409, 'You can follow up to 500 readers. Unfollow someone to make room.');
  return json({ following: true, profileId: profile.id });
}); }
