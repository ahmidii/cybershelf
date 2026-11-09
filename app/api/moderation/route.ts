import { authenticated, handled, HttpError, json } from '@/lib/server/http';
import { moderationQueue, requireModerator } from '@/lib/server/moderation';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request); await requireModerator(user.userId);
  const params = new URL(request.url).searchParams, status = params.get('status') || 'open';
  if (status !== 'open' && status !== 'dismissed' && status !== 'actioned') throw new HttpError(400, 'Choose a report status.');
  return json(await moderationQueue(status, params.get('cursor') ?? undefined));
}); }
