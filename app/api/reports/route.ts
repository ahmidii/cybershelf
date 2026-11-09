import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { reportTarget, REPORT_KINDS, REPORT_REASONS } from '@/lib/server/moderation';
import { reserveReadingAction } from '@/lib/server/journal';
const input = z.object({ kind: z.enum(REPORT_KINDS), targetId: z.string().min(1).max(100), reason: z.enum(REPORT_REASONS), details: z.string().trim().max(2000).default('') }).strict();
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const parsed = input.safeParse(await readJson(request, 16384));
  if (!parsed.success) throw new HttpError(400, 'Choose a reason and keep extra details under 2,000 characters.');
  await reserveReadingAction(user.userId, 'report');
  return json(await reportTarget(user.userId, parsed.data.kind, parsed.data.targetId, parsed.data.reason, parsed.data.details), 202);
}); }
