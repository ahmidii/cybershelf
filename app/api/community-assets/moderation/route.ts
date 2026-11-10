import { authenticated, handled, json } from '@/lib/server/http';
import { listSharedAssets } from '@/lib/server/community-assets';
import { requireModerator } from '@/lib/server/moderation';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request); await requireModerator(user.userId);
  return json(await listSharedAssets(new URL(request.url).searchParams, user.userId, true));
}); }
