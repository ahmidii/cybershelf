import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { reviewSharedAsset } from '@/lib/server/community-assets';
import { requireFreshModerator } from '@/lib/server/moderation';

const input = z.object({ action: z.enum(['approve', 'reject', 'withdraw']), note: z.string().trim().min(3).max(1000) }).strict();
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request); await requireFreshModerator(request, user.userId);
  const parsed = input.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, 'Choose a review decision and record a reason of 3–1,000 characters.');
  const { id } = await context.params;
  return json({ asset: await reviewSharedAsset(id, user.userId, parsed.data.action, parsed.data.note) });
}); }
