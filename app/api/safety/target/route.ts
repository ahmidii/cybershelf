import { authenticated, handled, HttpError, json } from '@/lib/server/http';
import { REPORT_KINDS, resolveSafetyTarget, type ReportKind } from '@/lib/server/moderation';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const user = await authenticated(request), params = new URL(request.url).searchParams;
  const kind = params.get('kind') as ReportKind, id = params.get('id') || '';
  if (!REPORT_KINDS.includes(kind)) throw new HttpError(400, 'Choose a public item.');
  const target = await resolveSafetyTarget(kind, id), own = target.ownerId === user.userId;
  return json({ accountId: user.userId, canReport: !own, canBlock: !!target.ownerId && !own });
}); }
