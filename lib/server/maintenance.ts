import { cleanupAssetTransfers } from './asset-transfers';
import { cleanupAccountDeletions } from './account-deletion';

type Bindings = { DB?: D1Database; BUCKET?: R2Bucket; MAINTENANCE_ENABLED?: string };
const KEY = 'housekeeping.v1';
const LEASE_MS = 10 * 60 * 1000;

export async function maintenanceStatus(bindings: Bindings, now = Date.now()) {
  const configured = bindings.MAINTENANCE_ENABLED === 'true' && !!bindings.DB && !!bindings.BUCKET;
  if (!configured) return { configured: false, started: false, recent: false, cleanupHealthy: false };
  const saved = await bindings.DB!.prepare('SELECT value FROM maintenance_state WHERE key = ?').bind(KEY).first<{ value: string }>();
  let state: { lastCompletedAt?: number; lastFailureAt?: number } = {};
  try { state = saved ? JSON.parse(saved.value) : {}; } catch { /* Invalid status never passes readiness. */ }
  const completed = Number(state.lastCompletedAt ?? 0);
  const overdue = await bindings.DB!.prepare(`SELECT 1 AS overdue FROM account_deletion_jobs
    WHERE requested_at < ? OR (attempts > 0 AND lease_until <= ?)
    UNION ALL SELECT 1 FROM asset_transfers WHERE
      (state='cleanup' AND created_at < ?) OR (state='uploading' AND expires_at < ?)
      OR (attempts > 0 AND lease_until <= ?) LIMIT 1`)
    .bind(now - 60 * 60 * 1000, now, now - 60 * 60 * 1000, now - 60 * 60 * 1000, now).first();
  const failedSinceCompletion = Number(state.lastFailureAt ?? 0) > completed;
  return { configured, started: !!saved, recent: Number.isFinite(completed) && completed > 0 && completed <= now && completed >= now - 15 * 60 * 1000,
    cleanupHealthy: !overdue && !failedSinceCompletion };
}

/** Cron work never depends on a reader visiting an account page. Durable
 * per-object/job claims provide the finer-grained protection; this lease keeps
 * overlapping scheduled invocations from spending the same batch budget. */
export async function runHousekeeping(bindings: Bindings, now = Date.now()) {
  if (bindings.MAINTENANCE_ENABLED !== 'true' || !bindings.DB || !bindings.BUCKET) return { status: 'disabled' as const };
  const db = bindings.DB, token = crypto.randomUUID(), leaseUntil = now + LEASE_MS;
  const claim = await db.prepare(`INSERT INTO maintenance_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = json_set(value, '$.leaseToken', ?, '$.leaseUntil', ?, '$.lastAttemptAt', ?), updated_at = ?
    WHERE COALESCE(json_extract(value, '$.leaseUntil'), 0) <= ? RETURNING key`)
    .bind(KEY, JSON.stringify({ leaseToken: token, leaseUntil, lastAttemptAt: now }), now, token, leaseUntil, now, now, now).first();
  if (!claim) return { status: 'busy' as const };
  try {
    // Separate backup cron plus small batches keep maintenance within a bounded
    // query/subrequest budget even when an account owns many files.
    const deleted = await cleanupAccountDeletions(bindings, { limit: 1, transferLimit: 8, now });
    const transfers = await cleanupAssetTransfers(bindings, { limit: 2, now });
    await db.batch([
      db.prepare('DELETE FROM account_erasure_ledger WHERE expires_at <= ?').bind(now),
      db.prepare('DELETE FROM account_action_limits WHERE window_start < ?').bind(now - 48 * 60 * 60 * 1000),
      db.prepare('DELETE FROM auth_rate_limit WHERE last_request < ?').bind(now - 48 * 60 * 60 * 1000),
    ]);
    if (transfers.failed) throw new Error('Maintenance cleanup needs retry.');
    await db.prepare(`UPDATE maintenance_state SET value = ?, updated_at = ? WHERE key = ? AND json_extract(value, '$.leaseToken') = ?`)
      .bind(JSON.stringify({ lastAttemptAt: now, lastCompletedAt: now, leaseUntil: 0, pendingDeletions: deleted.pending }), now, KEY, token).run();
    return { status: 'complete' as const };
  } catch {
    await db.prepare(`UPDATE maintenance_state SET value = json_set(value, '$.leaseUntil', 0, '$.lastFailureAt', ?), updated_at = ?
      WHERE key = ? AND json_extract(value, '$.leaseToken') = ?`).bind(now, now, KEY, token).run();
    // Fixed diagnostic only: no account IDs, filenames, object keys or queries.
    throw new Error('Cybershelf scheduled cleanup failed; durable retries remain queued.');
  }
}
