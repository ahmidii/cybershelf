import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { idSchema } from '@/lib/server/validation';
import { registerCommunityBook } from '@/lib/server/book-community';

export const dynamic = 'force-dynamic';
const input = z.object({ bookId: idSchema });
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const parsed = input.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, 'Choose a saved book from your Library.');
  const book = await registerCommunityBook(user.userId, parsed.data.bookId);
  return json({ id: book.id, book }, 201);
}); }
