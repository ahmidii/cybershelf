import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { idSchema } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ profileId: string }> }) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request); const { profileId } = await context.params;
  if (!idSchema.safeParse(profileId).success) throw new HttpError(404, 'Reader not found.');
  await database().prepare(`DELETE FROM follows WHERE follower_id=? AND
    (followed_profile_id=? OR followed_owner_id IN (SELECT owner_id FROM public_profiles WHERE id=?))`).bind(user.userId, profileId, profileId).run();
  return json({ following: false });
}); }
