import { z } from 'zod';
import { getCurrentUser } from '@/app/auth';
import { handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { resolveSharedBookAssets } from '@/lib/server/community-assets';

const input = z.object({ books: z.array(z.object({ id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  catalogId: z.string().max(100).optional(), editionId: z.string().regex(/^OL[1-9]\d{0,11}M$/).optional(), isbn: z.string().max(32).optional(),
}).strict()).max(100) }).strict();
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await getCurrentUser(), parsed = input.safeParse(await readJson(request, 32768));
  if (!parsed.success) throw new HttpError(400, 'Choose up to 100 book editions at a time.');
  return json(await resolveSharedBookAssets(parsed.data.books, user?.userId));
}); }
