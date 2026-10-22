import { authenticated, handled, json } from '@/lib/server/http';
import { readingRoom } from '@/lib/server/reading-room';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request);
  return json(await readingRoom(user.userId, new URL(request.url).searchParams));
}); }
