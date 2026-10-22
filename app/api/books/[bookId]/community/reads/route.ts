import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { idSchema } from '@/lib/server/validation';
import { isCommunityReadDate } from '@/lib/book-community';
import { addCommunityRead } from '@/lib/server/book-community';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ bookId: string }> };
const input = z.object({ id: idSchema, finishedAt: z.string().refine(value => isCommunityReadDate(value)) });
export async function POST(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const parsed = input.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, 'Choose a valid completed-read date in YYYY-MM-DD format. Future reads cannot be logged.');
  const result = await addCommunityRead((await context.params).bookId, user.userId, parsed.data);
  return json(result.response, result.created ? 201 : 200);
}); }
