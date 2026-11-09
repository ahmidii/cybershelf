export const ACCOUNT_ASSET_LIMIT_BYTES = 500 * 1024 * 1024;
export const ACCOUNT_ASSET_LIMIT_COUNT = 1000;
export const ACCOUNT_UPLOAD_IN_FLIGHT_LIMIT = 4;
export const UPLOAD_RESERVATION_MS = 10 * 60 * 1000;

export type AssetBindings = { DB?: D1Database; BUCKET?: R2Bucket; BETTER_AUTH_SECRET?: string };
export type AssetTransfer = {
  id: string; owner_id: string; object_key: string; size: number;
  state: 'uploading' | 'cleanup'; writer_done: number; created_at: number;
  updated_at: number; expires_at: number; next_attempt_at: number; attempts: number; lease_until: number;
};
export class AssetTransferError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) { super(message); }
}
function database(bindings: AssetBindings) {
  if (!bindings.DB) throw new AssetTransferError(503, 'File storage is temporarily unavailable.', 'STORAGE_UNAVAILABLE');
  return bindings.DB;
}
function storage(bindings: AssetBindings) {
  if (!bindings.BUCKET) throw new AssetTransferError(503, 'File storage is temporarily unavailable.', 'STORAGE_UNAVAILABLE');
  return bindings.BUCKET;
}

// Both reservation and finalization repeat this authoritative condition. A
// verified session from before a deletion/suspension cannot create new files.
const ACTIVE_OWNER = `EXISTS (SELECT 1 FROM auth_user WHERE id = ?)
  AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE owner_id = ?)
  AND NOT EXISTS (SELECT 1 FROM account_suspensions WHERE user_id = ?)`;
const ownerValues = (ownerId: string) => [ownerId, ownerId, ownerId];

export async function assetUsage(bindings: AssetBindings, ownerId: string) {
  const row = await database(bindings).prepare(`SELECT
    (SELECT COALESCE(SUM(size),0) FROM assets WHERE owner_id = ?) AS committed_bytes,
    (SELECT COUNT(*) FROM assets WHERE owner_id = ?) AS committed_count,
    (SELECT COALESCE(SUM(size),0) FROM asset_transfers WHERE owner_id = ?) AS pending_bytes,
    (SELECT COUNT(*) FROM asset_transfers WHERE owner_id = ?) AS pending_count,
    (SELECT COUNT(*) FROM asset_transfers WHERE owner_id = ? AND state = 'uploading') AS uploading`)
    .bind(ownerId, ownerId, ownerId, ownerId, ownerId)
    .first<{ committed_bytes: number; committed_count: number; pending_bytes: number; pending_count: number; uploading: number }>();
  if (!row) throw new AssetTransferError(503, 'File storage is temporarily unavailable.', 'STORAGE_UNAVAILABLE');
  return { usedBytes: row.committed_bytes + row.pending_bytes, usedCount: row.committed_count + row.pending_count,
    committedBytes: row.committed_bytes, pendingBytes: row.pending_bytes, pendingFiles: row.pending_count, uploading: row.uploading,
    limitBytes: ACCOUNT_ASSET_LIMIT_BYTES, limitCount: ACCOUNT_ASSET_LIMIT_COUNT };
}

/** Durable counters run before reading a multipart body. Identifiers are keyed
 * digests; raw addresses and account IDs do not enter the counter table. */
export async function limitUploadAttempts(bindings: AssetBindings, request: Request, ownerId: string, now = Date.now()) {
  const db = database(bindings), secret = bindings.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new AssetTransferError(503, 'File storage is temporarily unavailable.', 'STORAGE_UNAVAILABLE');
  const raw = request.headers.get('cf-connecting-ip') ?? '';
  const address = raw.length <= 64 && /^[a-fA-F0-9:.]+$/.test(raw) ? raw : 'unknown';
  const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const scopes = [
    { identity: 'owner:' + ownerId, period: 60_000, max: 30 },
    { identity: 'owner:' + ownerId, period: 3_600_000, max: 300 },
    { identity: 'ip:' + address, period: 60_000, max: 90 },
    { identity: 'ip:' + address, period: 3_600_000, max: 900 },
  ];
  const counters = await Promise.all(scopes.map(async scope => {
    const digest = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode('cybershelf.upload-limit.v1\0' + scope.period + '\0' + scope.identity));
    return { ...scope, key: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), window: Math.floor(now / scope.period) * scope.period };
  }));
  const results = await db.batch<{ count: number }>([
    ...counters.map(counter => db.prepare(`INSERT INTO account_action_limits (key, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN MIN(count + 1, ?) ELSE 1 END,
      window_start = excluded.window_start RETURNING count`).bind(counter.key, counter.window, counter.max + 1)),
    db.prepare('DELETE FROM account_action_limits WHERE window_start < ?').bind(now - 48 * 3_600_000),
  ]);
  for (let index = 0; index < counters.length; index++) {
    const count = Number(results[index].results[0]?.count);
    if (!Number.isFinite(count)) throw new AssetTransferError(503, 'File storage is temporarily unavailable.', 'STORAGE_UNAVAILABLE');
    if (count > counters[index].max) throw new AssetTransferError(429, 'You have uploaded quite a few files recently. Please wait before uploading more.', 'UPLOAD_RATE_LIMITED');
  }
}

/** One D1 statement checks the committed and reserved quota and claims room.
 * Cleanup obligations keep counting until their bytes have been removed. */
export async function reserveAssetTransfer(bindings: AssetBindings, ownerId: string, size: number, now = Date.now()): Promise<AssetTransfer> {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 25 * 1024 * 1024) throw new AssetTransferError(413, 'This file is too large.', 'FILE_TOO_LARGE');
  const db = database(bindings), id = 'as_' + crypto.randomUUID(), objectKey = 'private/' + id;
  const result = await db.prepare(`INSERT INTO asset_transfers
      (id, owner_id, object_key, size, state, writer_done, created_at, updated_at, expires_at, next_attempt_at, attempts, lease_until)
    SELECT ?, ?, ?, ?, 'uploading', 0, ?, ?, ?, 0, 0, 0 WHERE ${ACTIVE_OWNER}
      AND (SELECT COALESCE(SUM(size),0) FROM assets WHERE owner_id = ?) + (SELECT COALESCE(SUM(size),0) FROM asset_transfers WHERE owner_id = ?) + ? <= ?
      AND (SELECT COUNT(*) FROM assets WHERE owner_id = ?) + (SELECT COUNT(*) FROM asset_transfers WHERE owner_id = ?) < ?
      AND (SELECT COUNT(*) FROM asset_transfers WHERE owner_id = ? AND state = 'uploading') < ?
    RETURNING *`).bind(id, ownerId, objectKey, size, now, now, now + UPLOAD_RESERVATION_MS,
      ...ownerValues(ownerId), ownerId, ownerId, size, ACCOUNT_ASSET_LIMIT_BYTES, ownerId, ownerId, ACCOUNT_ASSET_LIMIT_COUNT, ownerId, ACCOUNT_UPLOAD_IN_FLIGHT_LIMIT)
    .first<AssetTransfer>();
  if (result) return result;
  const active = await db.prepare(`SELECT 1 AS active WHERE ${ACTIVE_OWNER}`).bind(...ownerValues(ownerId)).first();
  if (!active) throw new AssetTransferError(403, 'This account cannot upload files. Sign in again or check your account status.', 'ACCOUNT_UNAVAILABLE');
  const usage = await assetUsage(bindings, ownerId);
  if (usage.uploading >= ACCOUNT_UPLOAD_IN_FLIGHT_LIMIT) throw new AssetTransferError(429, 'A few files are already uploading. Let them finish before adding more.', 'UPLOAD_BUSY');
  throw new AssetTransferError(413, 'Your account has reached its storage limit (500 MB or 1,000 files). Remove unused files before uploading more.', 'STORAGE_LIMIT');
}

export async function finishAssetTransfer(bindings: AssetBindings, transfer: AssetTransfer,
  file: { kind: 'book' | 'image'; filename: string; mime: string }, now = Date.now()): Promise<boolean> {
  const db = database(bindings);
  const result = await db.batch([
    db.prepare(`INSERT INTO assets (id, owner_id, kind, object_key, filename, mime, size, created_at)
      SELECT id, owner_id, ?, object_key, ?, ?, size, ? FROM asset_transfers
      WHERE id = ? AND owner_id = ? AND state = 'uploading' AND expires_at > ? AND ${ACTIVE_OWNER}`)
      .bind(file.kind, file.filename, file.mime, new Date(now).toISOString(), transfer.id, transfer.owner_id, now, ...ownerValues(transfer.owner_id)),
    db.prepare(`DELETE FROM asset_transfers WHERE id = ? AND owner_id = ? AND EXISTS
      (SELECT 1 FROM assets a WHERE a.id = asset_transfers.id AND a.owner_id = asset_transfers.owner_id AND a.object_key = asset_transfers.object_key)`)
      .bind(transfer.id, transfer.owner_id),
  ]);
  return result[0].meta.changes === 1;
}

/** A failed DB response may follow a committed finalize. Only a still-present
 * reservation can be abandoned; a committed asset must never be removed here. */
export async function abandonAssetTransfer(bindings: AssetBindings, transfer: AssetTransfer, writerDone: boolean, now = Date.now()) {
  await database(bindings).prepare(`UPDATE asset_transfers SET state = 'cleanup', writer_done = MAX(writer_done, ?),
    updated_at = ?, next_attempt_at = ? WHERE id = ? AND owner_id = ?
    AND NOT EXISTS (SELECT 1 FROM assets WHERE id = asset_transfers.id AND object_key = asset_transfers.object_key)`)
    .bind(writerDone ? 1 : 0, now, now, transfer.id, transfer.owner_id).run();
}

export async function writeReservedAsset(bindings: AssetBindings, transfer: AssetTransfer, bytes: Uint8Array,
  file: { kind: 'book' | 'image'; filename: string; mime: string }) {
  let writerDone = false;
  try {
    // A cancellation marker at this opaque key permanently blocks a late put.
    // Never change this to an unconditional overwrite or reuse an asset key.
    const written = await storage(bindings).put(transfer.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: file.mime },
    });
    writerDone = true;
    if (!written || !await finishAssetTransfer(bindings, transfer, file)) {
      throw new AssetTransferError(409, 'This upload was cancelled or expired. Check your account and try again.', 'UPLOAD_CANCELLED');
    }
    return { id: transfer.id, filename: file.filename, mime: file.mime, size: transfer.size, url: '/api/assets/' + transfer.id };
  } catch (error) {
    // Keep the durable reservation if D1 itself is unavailable. Scheduled
    // expiry cleanup can still remove/seal the object when storage recovers.
    try {
      await abandonAssetTransfer(bindings, transfer, writerDone);
      await cleanupAssetTransfers(bindings, { ownerId: transfer.owner_id, limit: 2 });
    } catch { console.error('cybershelf upload cleanup deferred'); }
    if (error instanceof AssetTransferError) throw error;
    throw new AssetTransferError(503, 'The file could not be saved. Please try again shortly.', 'UPLOAD_UNAVAILABLE');
  }
}

/** Preserve a cleanup obligation in the same transaction that removes an asset
 * from the account. A bucket outage must not create an untracked original. */
export async function queueUnusedAssetRemoval(bindings: AssetBindings, ownerId: string, assetId: string, libraryVersion: number | null, now = Date.now()) {
  const db = database(bindings);
  const unused = `id = ? AND owner_id = ?
    AND ${libraryVersion === null ? 'NOT EXISTS (SELECT 1 FROM libraries WHERE owner_id = assets.owner_id)' : 'EXISTS (SELECT 1 FROM libraries WHERE owner_id = assets.owner_id AND version = ?)'}
    AND NOT EXISTS (SELECT 1 FROM publications p, json_each(p.image_ids) image WHERE p.owner_id = assets.owner_id AND image.value = assets.id)
    AND NOT EXISTS (SELECT 1 FROM public_profiles p, json_each(p.image_ids) image WHERE p.owner_id = assets.owner_id AND image.value = assets.id)
    AND NOT EXISTS (SELECT 1 FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id,
      json_each(p.image_ids) image WHERE p.owner_id = assets.owner_id AND image.value = assets.id)`;
  const values = [assetId, ownerId, ...(libraryVersion === null ? [] : [libraryVersion])];
  const results = await db.batch([
    db.prepare(`INSERT INTO asset_transfers (id, owner_id, object_key, size, state, writer_done, created_at, updated_at, expires_at, next_attempt_at, attempts, lease_until)
      SELECT id, owner_id, object_key, size, 'cleanup', 1, ?, ?, ?, ?, 0, 0 FROM assets WHERE ${unused}
      ON CONFLICT(id) DO UPDATE SET state = 'cleanup', writer_done = MAX(asset_transfers.writer_done, 1), updated_at = excluded.updated_at, next_attempt_at = excluded.next_attempt_at`)
      .bind(now, now, now, now, ...values),
    db.prepare(`DELETE FROM assets WHERE ${unused} AND EXISTS
      (SELECT 1 FROM asset_transfers t WHERE t.id = assets.id AND t.owner_id = assets.owner_id AND t.object_key = assets.object_key AND t.state = 'cleanup')`)
      .bind(...values),
  ]);
  return results[1].meta.changes === 1;
}

/** Idempotent bounded maintenance. Unknown/stalled writes are sealed with a
 * zero-byte, metadata-free marker. Such opaque markers may remain in R2; they
 * contain no book bytes, filename, account ID, or other personal metadata.
 * Deleting them on a timer would permit an arbitrarily late put to resurrect
 * data. Confirmed completed writes are safe to delete outright. */
export async function cleanupAssetTransfers(bindings: AssetBindings,
  options: { ownerId?: string; limit?: number; now?: number } = {}): Promise<{ processed: number; failed: number }> {
  const db = database(bindings), objects = storage(bindings), now = options.now ?? Date.now();
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
  const predicate = `((state = 'cleanup' AND next_attempt_at <= ?) OR (state = 'uploading' AND expires_at <= ?)) AND lease_until <= ?`;
  const candidates = await db.prepare(`SELECT id FROM asset_transfers WHERE ${predicate}${options.ownerId ? ' AND owner_id = ?' : ''} ORDER BY next_attempt_at, created_at LIMIT ?`)
    .bind(now, now, now, ...(options.ownerId ? [options.ownerId] : []), limit).all<{ id: string }>();
  let processed = 0, failed = 0;
  for (const candidate of candidates.results) {
    const lease = now + 120_000;
    const row = await db.prepare(`UPDATE asset_transfers SET state = 'cleanup', lease_until = ?, attempts = MIN(attempts + 1, 1000000), updated_at = ?
      WHERE id = ? AND ${predicate}
      AND NOT EXISTS (SELECT 1 FROM assets WHERE id = asset_transfers.id AND object_key = asset_transfers.object_key) RETURNING *`)
      .bind(lease, now, candidate.id, now, now, now).first<AssetTransfer>();
    if (!row) continue;
    try {
      if (row.writer_done) await objects.delete(row.object_key);
      else await objects.put(row.object_key, new Uint8Array(0));
      const removed = await db.prepare('DELETE FROM asset_transfers WHERE id = ? AND state = ? AND lease_until = ?')
        .bind(row.id, 'cleanup', lease).run();
      if (removed.meta.changes) processed++;
    } catch {
      failed++;
      const retry = now + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7));
      await db.prepare('UPDATE asset_transfers SET lease_until = 0, next_attempt_at = ?, updated_at = ? WHERE id = ? AND lease_until = ?')
        .bind(retry, now, row.id, lease).run();
    }
  }
  if (failed) console.error('cybershelf asset cleanup deferred');
  return { processed, failed };
}
