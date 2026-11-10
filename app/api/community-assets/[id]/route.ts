import { getCurrentUser } from '@/app/auth';
import { authenticated, handled, json, sameOrigin } from '@/lib/server/http';
import { getSharedAsset, withdrawSharedAsset } from '@/lib/server/community-assets';
import { configuredModerator, requireModerator } from '@/lib/server/moderation';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handled(async () => {
  const user = await getCurrentUser(), { id } = await context.params;
  const moderator = !!user && configuredModerator(user.userId);
  if (moderator) await requireModerator(user!.userId);
  return json({ asset: await getSharedAsset(id, user?.userId, moderator) });
}); }
export async function DELETE(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request), { id } = await context.params;
  return json(await withdrawSharedAsset(id, user.userId));
}); }
