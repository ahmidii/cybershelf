/** Recovery copies are private and separate from the serving bucket. The
 * checkpoint records operational counters and an opaque asset cursor only;
 * filenames, account identities and file contents never enter it or logs. */
export const ORIGINAL_BACKUP_STATE_KEY = 'original-backups.v1';
export const ORIGINAL_BACKUP_INTERVAL_MS = 24 * 60 * 60_000;
export const ORIGINAL_BACKUP_STALE_MS = 30 * 60 * 60_000;
export const ORIGINAL_BACKUP_FILE_LIMIT = 10;
export const ORIGINAL_BACKUP_BYTE_LIMIT = 64 * 1024 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const LEASE_MS = 10 * 60_000;

export type OriginalBackupBindings = { DB?: D1Database; BUCKET?: R2Bucket; BACKUP_BUCKET?: R2Bucket };
export type OriginalBackupCheckpoint = {
  version: 1; cursor: string | null; scanStartedAt: number | null;
  completedAt: number | null; completedScanStartedAt: number | null;
  scanFiles: number; scanBytes: number; lastScanFiles: number; lastScanBytes: number;
  nextAttemptAt: number; leaseToken: string; leaseUntil: number; failures: number;
  lastFailureAt: number | null; lastFailureCode: string | null;
};
export type OriginalBackupResult = {
  status: 'disabled' | 'busy' | 'waiting' | 'partial' | 'complete' | 'failed';
  copied: number; bytes: number; lastCompletedAt: number | null; error?: string;
};
type BackupAsset = { id: string; object_key: string; size: number; mime: string };
class BackupFailure extends Error { constructor(readonly code: string) { super(code); } }

function emptyCheckpoint(): OriginalBackupCheckpoint {
  return { version: 1, cursor: null, scanStartedAt: null, completedAt: null, completedScanStartedAt: null,
    scanFiles: 0, scanBytes: 0, lastScanFiles: 0, lastScanBytes: 0, nextAttemptAt: 0,
    leaseToken: '', leaseUntil: 0, failures: 0, lastFailureAt: null, lastFailureCode: null };
}
function checkpoint(value: string): OriginalBackupCheckpoint {
  try {
    const state = JSON.parse(value) as OriginalBackupCheckpoint;
    const timestamp = (value: unknown) => value === null || (Number.isSafeInteger(value) && Number(value) >= 0);
    if (state.version !== 1 || !(state.cursor === null || /^as_[A-Za-z0-9_-]{1,100}$/.test(state.cursor))
      || ![state.scanStartedAt, state.completedAt, state.completedScanStartedAt, state.lastFailureAt].every(timestamp)
      || ![state.scanFiles, state.scanBytes, state.lastScanFiles, state.lastScanBytes, state.nextAttemptAt, state.leaseUntil, state.failures]
        .every(value => Number.isSafeInteger(value) && value >= 0)
      || typeof state.leaseToken !== 'string' || state.leaseToken.length > 100
      || !(state.lastFailureCode === null || /^[A-Z_]{1,60}$/.test(state.lastFailureCode))
      || (state.scanStartedAt === null && state.cursor !== null)
      || ((state.completedAt === null) !== (state.completedScanStartedAt === null))) throw new Error();
    return state;
  } catch { throw new BackupFailure('CHECKPOINT_INVALID'); }
}

const activeAsset = `EXISTS (SELECT 1 FROM auth_user u WHERE u.id = a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs d WHERE d.owner_id = a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM account_erasure_ledger e WHERE e.owner_id = a.owner_id)`;
// Shared copies retain their opaque storage IDs after contributor deletion.
// A catalogue withdrawal has an independent erasure ledger and must never be
// restored merely because the original contributor no longer has an account.
const backupSources = `SELECT a.id,a.object_key,a.size,a.mime,a.created_at FROM assets a WHERE ${activeAsset}
  UNION ALL SELECT c.storage_id AS id,c.object_key,c.size,c.mime,c.created_at FROM community_assets c
  WHERE c.status IN ('pending','approved') AND NOT EXISTS (SELECT 1 FROM community_asset_erasures e WHERE e.asset_id=c.id)
    AND (c.status='approved' OR (EXISTS (SELECT 1 FROM auth_user u WHERE u.id=c.contributor_id)
      AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs d WHERE d.owner_id=c.contributor_id)
      AND NOT EXISTS (SELECT 1 FROM account_erasure_ledger e WHERE e.owner_id=c.contributor_id)))`;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return value === undefined ? fallback : Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : fallback;
}
async function withinDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new BackupFailure('COPY_TIMEOUT')), Math.max(1, deadline - Date.now()));
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function sameChecksum(left: ArrayBuffer, right: ArrayBuffer) {
  const a = new Uint8Array(left), b = new Uint8Array(right);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Copies at most ten files / 64 MiB by default. A full scan is resumable and
 * covers committed assets observed through its start time, not a transaction
 * spanning D1 and R2. New uploads wait for the next daily scan. A failure never
 * advances past an unconfirmed file or refreshes the completed-scan timestamp.
 *
 * R2 writes cannot be aborted once sent. A timed-out request may finish later;
 * repeated writes contain the same immutable bytes, and fenced D1 checkpoints
 * prevent an expired worker from claiming a successful scan. */
export async function backupOriginalAssets(bindings: OriginalBackupBindings,
  options: { limit?: number; maxBytes?: number; now?: number; maxRunMs?: number } = {}): Promise<OriginalBackupResult> {
  if (!bindings.BACKUP_BUCKET) return { status: 'disabled', copied: 0, bytes: 0, lastCompletedAt: null };
  if (!bindings.DB || !bindings.BUCKET || bindings.BUCKET === bindings.BACKUP_BUCKET) {
    return { status: 'failed', copied: 0, bytes: 0, lastCompletedAt: null, error: 'BACKUP_CONFIGURATION' };
  }
  const db = bindings.DB, sourceBucket = bindings.BUCKET, backupBucket = bindings.BACKUP_BUCKET;
  const wallStart = Date.now(), logicalStart = options.now ?? wallStart, now = () => logicalStart + Date.now() - wallStart;
  const deadline = wallStart + boundedInteger(options.maxRunMs, 50_000, 10, 50_000);
  const limit = boundedInteger(options.limit, ORIGINAL_BACKUP_FILE_LIMIT, 1, 50);
  const byteLimit = boundedInteger(options.maxBytes, ORIGINAL_BACKUP_BYTE_LIMIT, MAX_ASSET_BYTES, 256 * 1024 * 1024);
  let state = emptyCheckpoint(), encoded = '', ownsLease = false, copied = 0, bytes = 0;
  const result = (status: OriginalBackupResult['status'], error?: string): OriginalBackupResult =>
    ({ status, copied, bytes, lastCompletedAt: state.completedAt, ...(error ? { error } : {}) });
  const persist = async (next: OriginalBackupCheckpoint) => {
    const value = JSON.stringify(next), time = now();
    const saved = await db.prepare(`UPDATE maintenance_state SET value = ?, updated_at = ?
      WHERE key = ? AND value = ? AND json_extract(value, '$.leaseUntil') > ?`)
      .bind(value, time, ORIGINAL_BACKUP_STATE_KEY, encoded, time).run();
    if (saved.meta.changes !== 1) { ownsLease = false; throw new BackupFailure('LEASE_LOST'); }
    state = next; encoded = value;
  };
  try {
    const initial = await db.batch([
      db.prepare('INSERT INTO maintenance_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING')
        .bind(ORIGINAL_BACKUP_STATE_KEY, JSON.stringify(state), now()),
      db.prepare('SELECT value FROM maintenance_state WHERE key = ?').bind(ORIGINAL_BACKUP_STATE_KEY),
    ]);
    encoded = String((initial[1].results[0] as { value?: unknown } | undefined)?.value ?? '');
    state = checkpoint(encoded);
    if (state.leaseUntil > now()) return result('busy');
    if (state.nextAttemptAt > now()) return result('waiting');
    const started = state.scanStartedAt ?? now();
    const leased: OriginalBackupCheckpoint = { ...state, scanStartedAt: started,
      ...(state.scanStartedAt === null ? { cursor: null, scanFiles: 0, scanBytes: 0 } : {}),
      leaseToken: crypto.randomUUID(), leaseUntil: now() + LEASE_MS };
    const leaseValue = JSON.stringify(leased);
    const lease = await db.prepare('UPDATE maintenance_state SET value = ?, updated_at = ? WHERE key = ? AND value = ?')
      .bind(leaseValue, now(), ORIGINAL_BACKUP_STATE_KEY, encoded).run();
    if (lease.meta.changes !== 1) return result('busy');
    state = leased; encoded = leaseValue; ownsLease = true;
    const rows = await db.prepare(`SELECT a.id,a.object_key,a.size,a.mime FROM (${backupSources}) a
      WHERE a.id > ? AND a.created_at <= ? ORDER BY a.id LIMIT ?`)
      .bind(state.cursor ?? '', new Date(started).toISOString(), limit + 1).all<BackupAsset>();
    let processed = 0;
    for (const asset of rows.results.slice(0, limit)) {
      if (!/^as_[A-Za-z0-9_-]{1,100}$/.test(asset.id) || asset.object_key !== 'private/' + asset.id
        || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES) throw new BackupFailure('SOURCE_REFERENCE_INVALID');
      if (Date.now() >= deadline || bytes + asset.size > byteLimit) break;
      const original = await withinDeadline(sourceBucket.get(asset.object_key), deadline);
      // A deletion between the scan and GET is normal. A live metadata record
      // without matching bytes is an actionable failure, never a successful backup.
      const current = await db.prepare(`SELECT a.id FROM (${backupSources}) a WHERE a.id = ? AND a.object_key = ? AND a.size = ?`)
        .bind(asset.id, asset.object_key, asset.size).first();
      if (!current) {
        if (original) void original.body.cancel().catch(() => {});
      } else {
        if (!original) throw new BackupFailure('SOURCE_MISSING');
        if (original.size !== asset.size) {
          void original.body.cancel().catch(() => {});
          throw new BackupFailure('SOURCE_SIZE_MISMATCH');
        }
        const checksumName = (['sha256', 'sha512', 'sha384', 'sha1', 'md5'] as const).find(name => original.checksums[name]);
        const checksum = checksumName ? original.checksums[checksumName] : undefined;
        const written = await withinDeadline(backupBucket.put(asset.object_key, original.body, {
          httpMetadata: { contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(asset.mime) ? asset.mime : 'application/octet-stream' },
          customMetadata: {}, ...(checksumName && checksum ? { [checksumName]: checksum } : {}),
        }), deadline);
        // ETags can have multipart semantics. Only genuine R2 checksums are
        // used for checksum comparisons; a returned size is always checked.
        if (!written || written.size !== asset.size || (checksumName && checksum
          && (!written.checksums[checksumName] || !sameChecksum(checksum, written.checksums[checksumName]!)))) {
          throw new BackupFailure('COPY_VERIFICATION_FAILED');
        }
        copied++; bytes += asset.size;
      }
      processed++;
      await persist({ ...state, cursor: asset.id, scanFiles: state.scanFiles + (current ? 1 : 0),
        scanBytes: state.scanBytes + (current ? asset.size : 0), leaseUntil: now() + LEASE_MS });
    }
    if (processed === rows.results.length) {
      await persist({ ...state, cursor: null, scanStartedAt: null, completedAt: now(), completedScanStartedAt: started,
        lastScanFiles: state.scanFiles, lastScanBytes: state.scanBytes, scanFiles: 0, scanBytes: 0,
        nextAttemptAt: Math.max(now(), started + ORIGINAL_BACKUP_INTERVAL_MS), leaseToken: '', leaseUntil: 0,
        failures: 0, lastFailureAt: null, lastFailureCode: null });
      ownsLease = false;
      return result('complete');
    }
    await persist({ ...state, leaseToken: '', leaseUntil: 0, nextAttemptAt: now() });
    ownsLease = false;
    return result('partial');
  } catch (error) {
    const code = error instanceof BackupFailure ? error.code : 'BACKUP_UNAVAILABLE';
    if (code === 'LEASE_LOST') return result('busy');
    if (ownsLease) {
      try {
        const failures = Math.min(state.failures + 1, 1000000);
        await persist({ ...state, leaseToken: '', leaseUntil: 0, failures, lastFailureAt: now(), lastFailureCode: code,
          nextAttemptAt: now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 6)) });
      } catch { /* Retain the previous lease/checkpoint if D1 is unavailable. */ }
    }
    console.error('cybershelf original backup deferred');
    return result('failed', code);
  }
}

/** Operational health exposes completion age, never a file cursor or identity.
 * A recently touched checkpoint or partial scan does not establish freshness. */
export async function originalBackupStatus(bindings: OriginalBackupBindings, now = Date.now()) {
  const base = { configured: !!bindings.DB && !!bindings.BUCKET && !!bindings.BACKUP_BUCKET,
    lastCompletedAt: null as number | null, coveredScanStartedAt: null as number | null, scanStartedAt: null as number | null,
    pending: false, lastFailureAt: null as number | null, lastFailureCode: null as string | null };
  if (!bindings.BACKUP_BUCKET) return { ...base, state: 'disabled' as const };
  if (!bindings.DB || !bindings.BUCKET || bindings.BUCKET === bindings.BACKUP_BUCKET) return { ...base, state: 'failed' as const, lastFailureCode: 'BACKUP_CONFIGURATION' };
  try {
    const row = await bindings.DB.prepare('SELECT value FROM maintenance_state WHERE key = ?').bind(ORIGINAL_BACKUP_STATE_KEY).first<{ value: string }>();
    if (!row) return { ...base, state: 'never_completed' as const };
    const saved = checkpoint(row.value);
    const state = saved.lastFailureCode ? 'failed' : saved.completedScanStartedAt === null ? 'never_completed'
      : now - saved.completedScanStartedAt > ORIGINAL_BACKUP_STALE_MS ? 'stale' : 'current';
    return { ...base, state, lastCompletedAt: saved.completedAt, coveredScanStartedAt: saved.completedScanStartedAt,
      scanStartedAt: saved.scanStartedAt, pending: saved.scanStartedAt !== null,
      lastFailureAt: saved.lastFailureAt, lastFailureCode: saved.lastFailureCode };
  } catch (error) {
    return { ...base, state: 'failed' as const, lastFailureCode: error instanceof BackupFailure ? error.code : 'BACKUP_UNAVAILABLE' };
  }
}
