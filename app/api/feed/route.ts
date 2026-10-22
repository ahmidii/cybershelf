import { authenticated, handled, json } from '@/lib/server/http';
import { followingFeed, parseFeedCursor } from '@/lib/server/feed';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request), cursor = parseFeedCursor(new URL(request.url).searchParams.get('cursor'));
  return json(await followingFeed(user.userId, cursor));
}); }
