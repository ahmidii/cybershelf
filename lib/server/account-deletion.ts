import { ACCOUNT_ID_HEADER, AUTH_PASSWORD_MAX_LENGTH } from '../auth-contract';
import { ACCOUNT_FRESH_SESSION_SECONDS } from '../account-identity';
import { authConfiguration, AuthConfigurationError, createAuth, type AuthBindings } from './auth';
import { PasswordWorkLimitError, verifyAccountPassword } from './passwords';
import { cleanupAssetTransfers } from './asset-transfers';

export type AccountDeletionBindings = AuthBindings & { BUCKET?: R2Bucket };
type CleanupOptions = { ownerId?: string; limit?: number; transferLimit?: number; now?: number };
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
};
class DeletionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function reply(body: unknown, status = 200, headers?: Headers) {
  const output = new Headers(headers);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) output.set(name, value);
  return Response.json(body, { status, headers: output });
}

async function deletionBody(request: Request): Promise<{ currentPassword: string; confirmation: string }> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new DeletionError(415, 'INVALID_REQUEST', 'Send account details as JSON.');
  if (Number(request.headers.get('content-length') ?? 0) > 2048 || !request.body) throw new DeletionError(400, 'INVALID_REQUEST', 'Check your account deletion details.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new DeletionError(413, 'INVALID_REQUEST', 'This account request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new DeletionError(400, 'INVALID_REQUEST', 'Check your account deletion details.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['currentPassword', 'confirmation'].includes(key))) throw new DeletionError(400, 'INVALID_REQUEST', 'Check your account deletion details.');
  const candidate = body as { currentPassword?: unknown; confirmation?: unknown };
  if (candidate.confirmation !== 'DELETE') throw new DeletionError(400, 'CONFIRMATION_REQUIRED', 'Type DELETE to confirm permanently deleting this account.');
  if (typeof candidate.currentPassword !== 'string' || !candidate.currentPassword || candidate.currentPassword.length > AUTH_PASSWORD_MAX_LENGTH) throw new DeletionError(400, 'INVALID_PASSWORD', 'Enter your current password.');
  return { currentPassword: candidate.currentPassword, confirmation: candidate.confirmation };
}

async function limitDeletion(config: ReturnType<typeof authConfiguration>, ownerId: string) {
  const now = Date.now(), windowStart = Math.floor(now / 60000) * 60000;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('cybershelf.account-limit.v1\0delete-account\0user:' + ownerId));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await config.database.prepare('INSERT INTO account_action_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN MIN(count + 1, 6) ELSE 1 END, window_start = excluded.window_start RETURNING count').bind(id, windowStart).first<{ count: number }>();
  if (!result || !Number.isFinite(result.count)) throw new Error('Deletion limits unavailable.');
  if (result.count > 5) throw new DeletionError(429, 'RATE_LIMITED', 'A few too many attempts. Wait a minute before trying again.');
}

/** A completed job contains no account identity at all: the row is removed.
 * Pending jobs retain only an opaque former account ID and retry bookkeeping.
 * Private object contents are removed through the same durable transfer queue
 * used by uploads, including cancellation barriers for unfinished writes. */
export async function cleanupAccountDeletions(bindings: AccountDeletionBindings, options: CleanupOptions = {}) {
  if (!bindings.DB || !bindings.BUCKET) return { processed: 0, completed: 0, pending: 0 };
  const db = bindings.DB, now = options.now ?? Date.now();
  const limit = Math.min(10, Math.max(1, Math.trunc(options.limit ?? 3)));
  const selection = await db.prepare(`SELECT id, owner_id, attempts FROM account_deletion_jobs WHERE next_attempt_at <= ? AND lease_until <= ? ${options.ownerId ? 'AND owner_id = ?' : ''} ORDER BY requested_at ASC LIMIT ?`)
    .bind(now, now, ...(options.ownerId ? [options.ownerId] : []), limit).all<{ id: string; owner_id: string; attempts: number }>();
  let processed = 0, completed = 0, pending = 0;
  for (const job of selection.results) {
    const lease = now + 120_000;
    const claim = await db.prepare('UPDATE account_deletion_jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND lease_until <= ? AND next_attempt_at <= ?').bind(lease, now, job.id, now, now).run();
    if (claim.meta.changes !== 1) continue;
    processed++;
    let failed = false, madeProgress = false;
    try {
      const cleanup = await cleanupAssetTransfers({ DB: db, BUCKET: bindings.BUCKET }, { ownerId: job.owner_id, limit: options.transferLimit ?? 5, now });
      failed = cleanup.failed > 0;
      madeProgress = cleanup.processed > 0;
      const remaining = await db.prepare('SELECT COUNT(*) AS total FROM asset_transfers WHERE owner_id = ?').bind(job.owner_id).first<{ total: number }>();
      if (remaining?.total === 0) {
        const removed = await db.prepare('DELETE FROM account_deletion_jobs WHERE id = ? AND lease_until = ?').bind(job.id, lease).run();
        if (removed.meta.changes === 1) completed++;
        continue;
      }
    } catch {
      failed = true;
      // No filenames, credentials, usernames, addresses, or provider errors.
      console.error('cybershelf account file cleanup will retry');
    }
    pending++;
    // A large deletion is normal bounded work, not a failed attempt. Only
    // storage failures back off; successful batches can resume next cron tick.
    const attempts = failed ? Math.min(job.attempts + 1, 1000000) : madeProgress ? 0 : job.attempts;
    const retryDelay = failed ? Math.min(60 * 60_000, 60_000 * 2 ** Math.min(job.attempts, 6)) : 60_000;
    await db.prepare('UPDATE account_deletion_jobs SET lease_until = 0, next_attempt_at = ?, updated_at = ?, attempts = ? WHERE id = ? AND lease_until = ?').bind(now + retryDelay, now, attempts, job.id, lease).run();
  }
  return { processed, completed, pending };
}

export async function deleteAccount(request: Request, bindings: AccountDeletionBindings): Promise<Response> {
  try {
    const config = authConfiguration(bindings);
    if (!bindings.BUCKET) throw new DeletionError(503, 'DELETION_UNAVAILABLE', 'File storage is unavailable. Your account has not been deleted; try again shortly.');
    if (request.method !== 'POST') throw new DeletionError(405, 'METHOD_NOT_ALLOWED', 'Use a POST request.');
    if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DeletionError(403, 'INVALID_ORIGIN', 'Reload cybershelf before deleting your account.');
    const body = await deletionBody(request);
    const session = await createAuth(bindings).api.getSession({ headers: request.headers });
    if (!session) throw new DeletionError(401, 'UNAUTHORIZED', 'Sign in again before deleting your account.');
    const ownerId = session.user.id;
    if (request.headers.get(ACCOUNT_ID_HEADER) !== ownerId) throw new DeletionError(409, 'ACCOUNT_CHANGED', 'Your signed-in account changed. Reload before deleting anything.');
    await limitDeletion(config, ownerId);
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= ACCOUNT_FRESH_SESSION_SECONDS * 1000) throw new DeletionError(403, 'FRESH_SESSION_REQUIRED', 'Sign in again before permanently deleting your account.');
    const credential = await config.database.prepare("SELECT id, password FROM auth_account WHERE user_id = ? AND provider_id = 'credential' LIMIT 1").bind(ownerId).first<{ id: string; password: string }>();
    if (!credential?.password || !await verifyAccountPassword({ hash: credential.password, password: body.currentPassword })) throw new DeletionError(400, 'INVALID_PASSWORD', 'Your current password did not match.');
    const db = config.database, now = Date.now(), jobId = 'del_' + crypto.randomUUID();
    const claimed = 'EXISTS (SELECT 1 FROM account_deletion_jobs WHERE id = ? AND owner_id = ?)';
    const statements = [
      db.prepare(`INSERT INTO account_deletion_jobs (id, owner_id, requested_at, updated_at, next_attempt_at, attempts, lease_until)
        SELECT ?, ?, ?, ?, ?, 0, 0 WHERE EXISTS (SELECT 1 FROM auth_session WHERE id = ? AND user_id = ? AND expires_at > ? AND created_at > ?)
          AND EXISTS (SELECT 1 FROM auth_account WHERE id = ? AND user_id = ? AND provider_id = 'credential' AND password = ?)
        ON CONFLICT(owner_id) DO NOTHING`).bind(jobId, ownerId, now, now, now, session.session.id, ownerId, now, now - ACCOUNT_FRESH_SESSION_SECONDS * 1000, credential.id, ownerId, credential.password),
      // Only an opaque account ID survives for the backup reconciliation
      // window. A restore must apply this ledger before it can serve traffic.
      db.prepare(`INSERT INTO account_erasure_ledger (owner_id, requested_at, expires_at) SELECT ?, ?, ? WHERE ${claimed} ON CONFLICT(owner_id) DO NOTHING`).bind(ownerId, now, now + 35 * 24 * 60 * 60_000, jobId, ownerId),
      db.prepare(`INSERT INTO asset_transfers (id, owner_id, object_key, size, state, writer_done, created_at, updated_at, expires_at, next_attempt_at, attempts, lease_until)
        SELECT id, owner_id, object_key, size, 'cleanup', 1, ?, ?, ?, ?, 0, 0 FROM assets WHERE owner_id = ? AND ${claimed}
        ON CONFLICT(id) DO UPDATE SET state = 'cleanup', updated_at = excluded.updated_at, next_attempt_at = excluded.next_attempt_at`).bind(now, now, now, now, ownerId, jobId, ownerId),
      db.prepare(`UPDATE asset_transfers SET state = 'cleanup', updated_at = ?, next_attempt_at = ? WHERE owner_id = ? AND ${claimed}`).bind(now, now, ownerId, jobId, ownerId),
      db.prepare(`DELETE FROM reading_comments WHERE (owner_id = ? OR post_id IN (SELECT id FROM reading_posts WHERE owner_id = ?)) AND ${claimed}`).bind(ownerId, ownerId, jobId, ownerId),
      ...['reading_posts', 'publications', 'public_profiles', 'reading_events', 'libraries', 'assets'].map(table => db.prepare(`DELETE FROM ${table} WHERE owner_id = ? AND ${claimed}`).bind(ownerId, jobId, ownerId)),
      db.prepare(`DELETE FROM moderation_actions WHERE (moderator_id = ? OR target_owner_id = ? OR report_id IN (SELECT id FROM moderation_reports WHERE reporter_id = ? OR target_owner_id = ?)) AND ${claimed}`).bind(ownerId, ownerId, ownerId, ownerId, jobId, ownerId),
      db.prepare(`DELETE FROM moderation_reports WHERE (reporter_id = ? OR target_owner_id = ?) AND ${claimed}`).bind(ownerId, ownerId, jobId, ownerId),
      db.prepare(`DELETE FROM auth_verification WHERE (value = ? OR identifier = ?) AND ${claimed}`).bind(ownerId, session.user.email, jobId, ownerId),
      // Native FK cascades remove sessions, passwords/provider accounts,
      // recovery keys, follows, reads/ratings, blocks, hidden state and bans.
      db.prepare(`DELETE FROM auth_user WHERE id = ? AND ${claimed} RETURNING id`).bind(ownerId, jobId, ownerId),
    ];
    const result = await db.batch(statements);
    const deletedId = (result[result.length - 1].results as Array<{ id?: unknown }>)?.[0]?.id;
    if (result[0].meta.changes !== 1 || deletedId !== ownerId) throw new DeletionError(409, 'ACCOUNT_CHANGED', 'Your account changed during this request. Reload to check its status.');
    // Acceptance is durable before touching R2. A bucket outage cannot restore
    // account access or leave a public image route pointing to queued bytes.
    try { await cleanupAccountDeletions(bindings, { ownerId, limit: 1 }); }
    catch { console.error('cybershelf account file cleanup will retry'); }
    const pending = !!await db.prepare('SELECT id FROM account_deletion_jobs WHERE owner_id = ?').bind(ownerId).first();
    const headers = new Headers();
    for (const prefix of ['cybershelf', '__Secure-cybershelf']) {
      for (const name of ['session_token', 'session_data', 'dont_remember']) headers.append('Set-Cookie', `${prefix}.${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`);
    }
    return reply({ deleted: true, filesPending: pending }, pending ? 202 : 200, headers);
  } catch (error) {
    if (error instanceof DeletionError) return reply({ code: error.code, message: error.message }, error.status);
    if (error instanceof AuthConfigurationError || error instanceof PasswordWorkLimitError) return reply({ code: 'DELETION_UNAVAILABLE', message: 'Account security is busy or unavailable. Please try again shortly.' }, 503);
    console.error('cybershelf account deletion could not complete');
    return reply({ code: 'DELETION_UNAVAILABLE', message: 'We could not confirm account deletion. Reload to check your account before trying again.' }, 503);
  }
}
