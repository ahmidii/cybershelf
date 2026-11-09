import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { blockTarget, publicContentSql, REPORT_KINDS } from '@/lib/server/moderation';
import { reserveReadingAction } from '@/lib/server/journal';
const input = z.object({ kind: z.enum(REPORT_KINDS), targetId: z.string().min(1).max(100) }).strict();
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request);
  const result = await database().prepare(`SELECT b.id,b.created_at,p.id AS profile_id,json_extract(p.snapshot,'$.name') AS name FROM reader_blocks b LEFT JOIN public_profiles p ON p.owner_id=b.blocked_owner_id AND ${publicContentSql('profile', 'p.id', 'p.owner_id')} WHERE b.blocker_id=? ORDER BY b.created_at DESC,b.id DESC LIMIT 500`).bind(user.userId).all<{ id: string; created_at: string; profile_id: string | null; name: string | null }>();
  return json({ items: result.results.map(row => ({ id: row.id, name: row.name || 'Unavailable reader', profileId: row.profile_id, createdAt: row.created_at })) });
}); }
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const parsed = input.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, 'Choose a reader to block.');
  await reserveReadingAction(user.userId, 'block');
  return json(await blockTarget(user.userId, parsed.data.kind, parsed.data.targetId));
}); }
