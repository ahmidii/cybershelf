import { authenticated, handled, json } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { configuredModerator } from '@/lib/server/moderation';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request);
  const suspended = await database().prepare('SELECT reason FROM account_suspensions WHERE user_id=?').bind(user.userId).first<{ reason: string }>();
  return json({ accountId: user.userId, suspended: !!suspended, message: suspended?.reason ?? null, moderator: configuredModerator(user.userId) && !suspended });
}); }
