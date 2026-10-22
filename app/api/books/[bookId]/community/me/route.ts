import { authenticated, handled, json } from '@/lib/server/http';
import { myBookCommunity } from '@/lib/server/book-community';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ bookId: string }> };
export async function GET(request: Request, context: Context) { return handled(async () => {
  const user = await authenticated(request);
  return json(await myBookCommunity((await context.params).bookId, user.userId));
}); }
