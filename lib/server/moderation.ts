import { env } from 'cloudflare:workers';
import { HttpError } from './http';
import { database } from './storage';
import { createAuth } from './auth';

export const REPORT_KINDS = ['profile', 'shelf', 'post', 'comment', 'activity', 'book'] as const;
export const REPORT_REASONS = ['harassment', 'hate', 'sexual', 'violence', 'spam', 'privacy', 'copyright', 'other'] as const;
export type ReportKind = typeof REPORT_KINDS[number];
export interface SafetyTarget { kind: ReportKind; id: string; ownerId: string | null; profileId: string | null; snapshot: Record<string, string>; }

/** Column expressions are fixed application SQL, never request input. These
 * predicates are applied before pagination and before returning public data. */
export function publicOwnerSql(owner: string) {
  return `(EXISTS (SELECT 1 FROM auth_user safety_user WHERE safety_user.id=${owner}) AND NOT EXISTS (SELECT 1 FROM account_suspensions safety_suspend WHERE safety_suspend.user_id=${owner}))`;
}
export function publicContentSql(kind: ReportKind, id: string, owner?: string) {
  return `(${owner ? publicOwnerSql(owner) + ' AND ' : ''}NOT EXISTS (SELECT 1 FROM moderation_hidden safety_hidden WHERE safety_hidden.target_kind='${kind}' AND safety_hidden.target_id=${id}))`;
}
export function noBlockSql(viewer: string, owner: string) {
  return `NOT EXISTS (SELECT 1 FROM reader_blocks safety_block WHERE (safety_block.blocker_id=${viewer} AND safety_block.blocked_owner_id=${owner}) OR (safety_block.blocker_id=${owner} AND safety_block.blocked_owner_id=${viewer}))`;
}

export function configuredModerator(ownerId: string, setting = (env as unknown as { MODERATOR_USER_IDS?: string }).MODERATOR_USER_IDS): boolean {
  if (!setting || setting.length > 4096) return false;
  const ids = setting.split(',').map(value => value.trim()).filter(Boolean);
  return ids.length <= 20 && ids.every(value => /^[A-Za-z0-9_-]{1,128}$/.test(value)) && ids.includes(ownerId);
}
export async function requireModerator(ownerId: string) {
  if (!configuredModerator(ownerId)) throw new HttpError(403, 'This area is for configured Cybershelf moderators.');
  await requireParticipation(ownerId);
}
export async function requireFreshModerator(request: Request, ownerId: string) {
  await requireModerator(ownerId);
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  const age = session ? Date.now() - new Date(session.session.createdAt).getTime() : Infinity;
  if (!session || session.user.id !== ownerId || !Number.isFinite(age) || age < 0 || age >= 15 * 60 * 1000) throw new HttpError(403, 'Sign in again before taking moderation actions.', 'FRESH_SESSION_REQUIRED');
}
export async function requireParticipation(ownerId: string) {
  const status = await database().prepare('SELECT 1 AS suspended FROM account_suspensions WHERE user_id=?').bind(ownerId).first();
  if (status) throw new HttpError(403, 'Public participation is paused for this account. You can still use, export, or delete your private library.', 'ACCOUNT_SUSPENDED');
}
export async function requireUnblocked(viewerId: string, ownerId: string) {
  const row = await database().prepare('SELECT 1 AS blocked FROM reader_blocks WHERE (blocker_id=? AND blocked_owner_id=?) OR (blocker_id=? AND blocked_owner_id=?) LIMIT 1').bind(viewerId, ownerId, ownerId, viewerId).first();
  if (row) throw new HttpError(404, 'This reader or conversation is not available.');
}
export async function viewerCanSee(viewerId: string | undefined, ownerId: string): Promise<boolean> {
  if (!viewerId) return true;
  return !await database().prepare('SELECT 1 AS blocked FROM reader_blocks WHERE (blocker_id=? AND blocked_owner_id=?) OR (blocker_id=? AND blocked_owner_id=?) LIMIT 1').bind(viewerId, ownerId, ownerId, viewerId).first();
}

const text = (value: unknown, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
function parsed(value: string): Record<string, any> { try { return JSON.parse(value); } catch { return {}; } }

/** Resolve only currently public material from authoritative tables. Client
 * requests never supply an owner ID, report excerpt or arbitrary source URL. */
export async function resolveSafetyTarget(kind: ReportKind, id: string, includeHidden = false): Promise<SafetyTarget> {
  const db = database();
  // Only the moderator detail route opts into this view, after resolving the
  // target from an existing report. It still reads published-table text only.
  const visible = (type: ReportKind, key: string, owner?: string) => includeHidden
    ? owner ? `EXISTS (SELECT 1 FROM auth_user safety_user WHERE safety_user.id=${owner})` : '1'
    : publicContentSql(type,key,owner);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new HttpError(404, 'That public item is no longer available.');
  let target: SafetyTarget | undefined;
  if (kind === 'profile') {
    const row = await db.prepare(`SELECT id,owner_id,snapshot FROM public_profiles p WHERE id=? AND ${visible('profile', 'p.id', 'p.owner_id')}`).bind(id).first<{ id: string; owner_id: string; snapshot: string }>();
    if (row) { const value = parsed(row.snapshot); target = { kind, id, ownerId: row.owner_id, profileId: id, snapshot: { name: text(value.name, 80), body: text(value.bio), url: '/u/' + id } }; }
  } else if (kind === 'shelf') {
    const row = await db.prepare(`SELECT p.owner_id,p.snapshot,r.id AS profile_id FROM publications p LEFT JOIN public_profiles r ON r.owner_id=p.owner_id WHERE p.id=? AND ${visible('shelf', 'p.id', 'p.owner_id')}`).bind(id).first<{ owner_id: string; snapshot: string; profile_id: string | null }>();
    if (row) { const value = parsed(row.snapshot); target = { kind, id, ownerId: row.owner_id, profileId: row.profile_id, snapshot: { name: text(value.name, 80), title: text(value.shelf?.title ?? value.title, 200), body: text(value.shelf?.description ?? value.description), url: '/s/' + id } }; }
  } else if (kind === 'post' || kind === 'comment') {
    const row = kind === 'post'
      ? await db.prepare(`SELECT p.owner_id,p.profile_id,p.snapshot,r.snapshot AS profile_snapshot FROM reading_posts p JOIN public_profiles r ON r.id=p.profile_id AND r.owner_id=p.owner_id WHERE p.id=? AND ${visible('post', 'p.id', 'p.owner_id')} AND ${visible('profile', 'r.id', 'r.owner_id')}`).bind(id).first<{ owner_id: string; profile_id: string; snapshot: string; profile_snapshot: string }>()
      : await db.prepare(`SELECT c.owner_id,c.profile_id,c.name,c.body,c.post_id FROM reading_comments c JOIN reading_posts p ON p.id=c.post_id JOIN public_profiles r ON r.id=p.profile_id AND r.owner_id=p.owner_id WHERE c.id=? AND ${visible('comment', 'c.id', 'c.owner_id')} AND ${visible('post', 'p.id', 'p.owner_id')} AND ${visible('profile', 'r.id', 'r.owner_id')} AND (c.profile_id IS NULL OR EXISTS (SELECT 1 FROM public_profiles cp WHERE cp.id=c.profile_id AND cp.owner_id=c.owner_id AND ${visible('profile', 'cp.id', 'cp.owner_id')}))`).bind(id).first<{ owner_id: string; profile_id: string | null; name: string; body: string; post_id: string }>();
    if (row) {
      if ('snapshot' in row) { const value = parsed(row.snapshot), profile = parsed(row.profile_snapshot); target = { kind, id, ownerId: row.owner_id, profileId: row.profile_id, snapshot: { name: text(profile.name, 80), title: text(value.book?.title, 300), body: text(value.entry?.body, 4000), url: '/j/' + id } }; }
      else target = { kind, id, ownerId: row.owner_id, profileId: row.profile_id, snapshot: { name: text(row.name, 80), body: text(row.body, 4000), url: '/j/' + row.post_id + '#comment-' + id } };
    }
  } else if (kind === 'activity') {
    const row = await db.prepare(`SELECT a.owner_id,a.profile_id,a.kind,a.snapshot,p.snapshot AS profile_snapshot FROM reader_activity a JOIN public_profiles p ON p.id=a.profile_id AND p.owner_id=a.owner_id WHERE a.id=? AND ${visible('activity', 'a.id', 'a.owner_id')} AND ${visible('profile', 'p.id', 'p.owner_id')}`).bind(id).first<{ owner_id: string; profile_id: string; kind: string; snapshot: string; profile_snapshot: string }>();
    if (row) { const book = parsed(row.snapshot); target = { kind, id, ownerId: row.owner_id, profileId: row.profile_id, snapshot: { name: text(parsed(row.profile_snapshot).name, 80), title: text(book.title, 300), body: row.kind === 'purchased' ? 'Shared a book purchase' : 'Shared a library addition', url: '/u/' + row.profile_id } }; }
  } else if (kind === 'book' && /^cs_[a-f0-9]{64}$/.test(id)) {
    const row = await db.prepare(`SELECT title,author FROM community_books b WHERE b.id=? AND ${visible('book', 'b.id')}`).bind(id).first<{ title: string; author: string }>();
    if (row) target = { kind, id, ownerId: null, profileId: null, snapshot: { title: text(row.title, 300), name: text(row.author, 300), url: '/books/' + id } };
  }
  if (!target) throw new HttpError(404, 'That public item is no longer available.');
  return target;
}

export async function reportTarget(reporterId: string, kind: ReportKind, targetId: string, reason: string, details: string) {
  const target = await resolveSafetyTarget(kind, targetId);
  if (target.ownerId === reporterId) throw new HttpError(400, 'You can edit or unshare your own content from your reading space.');
  const now = new Date().toISOString(), before = new Date(Date.now() - 86400000).toISOString();
  const db = database();
  await db.prepare(`INSERT INTO moderation_reports (id,reporter_id,target_kind,target_id,target_owner_id,reason,details,public_snapshot,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(reporter_id,target_kind,target_id) DO UPDATE SET reason=excluded.reason,details=excluded.details,public_snapshot=excluded.public_snapshot,status='open',updated_at=excluded.updated_at WHERE moderation_reports.status<>'open' AND moderation_reports.updated_at<?`)
    .bind('report_' + crypto.randomUUID(), reporterId, kind, targetId, target.ownerId, reason, details, JSON.stringify(target.snapshot), now, now, before).run();
  return { received: true };
}

export async function blockTarget(blockerId: string, kind: ReportKind, targetId: string) {
  const target = await resolveSafetyTarget(kind, targetId);
  if (!target.ownerId || target.ownerId === blockerId) throw new HttpError(400, 'Choose another reader to block.');
  const db = database(), owner = target.ownerId;
  const result = await db.batch([
    db.prepare(`INSERT INTO reader_blocks (id,blocker_id,blocked_owner_id,blocked_profile_id,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM reader_blocks WHERE blocker_id=?)<500 ON CONFLICT(blocker_id,blocked_owner_id) DO NOTHING`).bind('block_' + crypto.randomUUID(), blockerId, owner, target.profileId, new Date().toISOString(), blockerId),
    db.prepare('DELETE FROM follows WHERE ((follower_id=? AND followed_owner_id=?) OR (follower_id=? AND followed_owner_id=?)) AND EXISTS (SELECT 1 FROM reader_blocks WHERE blocker_id=? AND blocked_owner_id=?)').bind(blockerId, owner, owner, blockerId, blockerId, owner),
    db.prepare('SELECT id FROM reader_blocks WHERE blocker_id=? AND blocked_owner_id=?').bind(blockerId, owner),
  ]);
  if (!result[2].results.length) throw new HttpError(409, 'You can block up to 500 readers. Remove an old block to make room.');
  return { blocked: true };
}

export async function moderationQueue(status: 'open' | 'dismissed' | 'actioned', cursor?: string) {
  let after: [string,string] | null = null;
  if (cursor) {
    try { const value = cursor.length <= 500 ? JSON.parse(atob(cursor)) : null;
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || value[0].length > 40 || !Number.isFinite(Date.parse(value[0])) || typeof value[1] !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value[1])) throw new Error();
      after = [value[0],value[1]];
    } catch { throw new HttpError(400,'Refresh the moderation queue before opening this page.'); }
  }
  const db = database();
  const rows = await db.prepare(`SELECT id,target_kind,target_id,target_owner_id,reason,details,public_snapshot,status,created_at,updated_at FROM moderation_reports WHERE status=? AND (? IS NULL OR updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT 51`).bind(status, after?.[0]??null, after?.[0]??null, after?.[0]??null, after?.[1]??null).all<{ id: string; target_kind: ReportKind; target_id: string; target_owner_id: string | null; reason: string; details: string; public_snapshot: string; status: string; created_at: string; updated_at: string }>();
  const items = rows.results.slice(0, 50).map(row => ({ id: row.id, kind: row.target_kind, targetId: row.target_id, canSuspend: !!row.target_owner_id, reason: row.reason, details: row.details, snapshot: parsed(row.public_snapshot), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
  const counts = await db.prepare("SELECT SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM moderation_reports").first<{ open: number }>();
  return { items, openCount: counts?.open ?? 0, ...(rows.results.length > 50 ? { nextCursor: btoa(JSON.stringify([items.at(-1)!.updatedAt,items.at(-1)!.id])) } : {}) };
}

export async function moderateReport(moderatorId: string, reportId: string, action: 'dismiss' | 'hide' | 'suspend' | 'restore' | 'unsuspend', note: string) {
  const db = database();
  const report = await db.prepare('SELECT target_kind,target_id,target_owner_id FROM moderation_reports WHERE id=?').bind(reportId).first<{ target_kind: ReportKind; target_id: string; target_owner_id: string | null }>();
  if (!report) throw new HttpError(404, 'This report is no longer available.');
  if ((action === 'suspend' || action === 'unsuspend') && (!report.target_owner_id || report.target_owner_id === moderatorId || configuredModerator(report.target_owner_id))) throw new HttpError(400, 'This account cannot be suspended through this report.');
  const now = new Date().toISOString(), statements: D1PreparedStatement[] = [];
  if (action === 'hide') statements.push(db.prepare('INSERT INTO moderation_hidden (target_kind,target_id,owner_id,moderator_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(target_kind,target_id) DO NOTHING').bind(report.target_kind, report.target_id, report.target_owner_id, moderatorId, now));
  if (action === 'restore') statements.push(db.prepare('DELETE FROM moderation_hidden WHERE target_kind=? AND target_id=?').bind(report.target_kind, report.target_id));
  if (action === 'suspend') statements.push(db.prepare('INSERT INTO account_suspensions (user_id,reason,moderator_id,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(report.target_owner_id, 'Public participation is paused after a moderation review.', moderatorId, now));
  if (action === 'unsuspend') statements.push(db.prepare('DELETE FROM account_suspensions WHERE user_id=?').bind(report.target_owner_id));
  const status = action === 'dismiss' ? 'dismissed' : 'actioned';
  statements.push(db.prepare('UPDATE moderation_reports SET status=?,updated_at=? WHERE id=?').bind(status, now, reportId));
  statements.push(db.prepare('INSERT INTO moderation_actions (id,report_id,moderator_id,target_owner_id,action,note,created_at) VALUES (?,?,?,?,?,?,?)').bind('action_' + crypto.randomUUID(), reportId, moderatorId, report.target_owner_id, action, note, now));
  await db.batch(statements);
  return { status };
}
