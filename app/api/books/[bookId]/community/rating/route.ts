import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { setCommunityRating } from '@/lib/server/book-community';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ bookId: string }> };
const input = z.object({ rating: z.number().min(.5).max(5).multipleOf(.5).nullable() });
export async function PUT(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const parsed = input.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, 'Choose a rating from half a star to five stars, or clear your rating.');
  return json(await setCommunityRating((await context.params).bookId, user.userId, parsed.data.rating));
}); }
