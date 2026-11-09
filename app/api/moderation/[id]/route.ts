import { z } from 'zod';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { moderateReport, requireFreshModerator, requireModerator, resolveSafetyTarget, type ReportKind } from '@/lib/server/moderation';
const input = z.object({ action: z.enum(['dismiss', 'hide', 'suspend', 'restore', 'unsuspend']), note: z.string().trim().min(3).max(1000) }).strict();
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handled(async () => {
  const user = await authenticated(request); await requireModerator(user.userId); const { id } = await context.params;
  const result = await database().prepare('SELECT id,moderator_id,action,note,created_at FROM moderation_actions WHERE report_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(id).all();
  const report=await database().prepare('SELECT target_kind,target_id FROM moderation_reports WHERE id=?').bind(id).first<{target_kind:ReportKind;target_id:string}>();
  if(!report)throw new HttpError(404,'This report is no longer available.');
  let current=null;try{current=(await resolveSafetyTarget(report.target_kind,report.target_id,true)).snapshot;}catch(error){if(!(error instanceof HttpError&&error.status===404))throw error;}
  return json({ actions: result.results, current });
}); }
export async function POST(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request); await requireFreshModerator(request,user.userId); const { id } = await context.params;
  const parsed = input.safeParse(await readJson(request, 8192));
  if (!parsed.success) throw new HttpError(400, 'Choose an action and record a reason of 3–1,000 characters.');
  return json(await moderateReport(user.userId, id, parsed.data.action, parsed.data.note));
}); }
