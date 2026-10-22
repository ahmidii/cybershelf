import { handled, json } from '@/lib/server/http';
import { bookCommunity } from '@/lib/server/book-community';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ bookId: string }> };
export async function GET(_request: Request, context: Context) { return handled(async () => {
  return json(await bookCommunity((await context.params).bookId));
}); }
