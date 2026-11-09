import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./original-backups.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { backupOriginalAssets, originalBackupStatus, ORIGINAL_BACKUP_STATE_KEY, ORIGINAL_BACKUP_INTERVAL_MS } =
  await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

/** Requires its own empty, migrated disposable D1 and two disposable R2
 * buckets. Missing sources in unrelated fixtures must not be ignored just to
 * make a complete recovery-copy scan pass. No production bindings are read. */
export async function runOriginalBackupIntegration({ database, bucket: sourceBinding, backupBucket: recoveryBinding, report = () => {} }) {
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM assets').first()).n, 0, 'Use an isolated backup fixture database');
  // Miniflare's Node proxy strips the known-length property from R2 body
  // streams. Only this host-side fixture converts its tiny synthetic bodies
  // back into byte arrays; the production helper still passes a stream, and
  // the scheduled Worker fixture checks native R2-to-R2 streaming separately.
  // A hard 512-byte ceiling prevents this adapter from buffering reader files.
  const syntheticBucket = target => ({
    get: (...args) => target.get(...args), head: (...args) => target.head(...args), delete: (...args) => target.delete(...args),
    async put(key, value, options) {
      if (typeof value?.getReader === 'function') {
        const reader = value.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value: chunk } = await reader.read(); if (done) break;
            size += chunk.length;
            assert.ok(size <= 512, 'The host stream bridge accepts tiny synthetic fixture bodies only');
            chunks.push(chunk);
          }
        } catch (error) { await reader.cancel(); throw error; }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return target.put(key, bytes, options);
      }
      return target.put(key, value, options);
    },
  });
  const bucket = syntheticBucket(sourceBinding), backupBucket = syntheticBucket(recoveryBinding);
  const bindings = { DB: database, BUCKET: bucket, BACKUP_BUCKET: backupBucket };
  const suffix = crypto.randomUUID().replaceAll('-', ''), owner = 'backup_' + suffix, start = Date.now() + 60_000;
  const body = new TextEncoder().encode('%PDF-1.7\nA synthetic restore canary, never reader content.');
  const assets = Array.from({ length: 3 }, (_, index) => ({ id: 'as_0' + (index + 1) + '_' + suffix, body }));
  const key = id => 'private/' + id;
  const state = async () => JSON.parse((await database.prepare('SELECT value FROM maintenance_state WHERE key=?').bind(ORIGINAL_BACKUP_STATE_KEY).first()).value);
  const putAsset = async (asset, time) => {
    await bucket.put(key(asset.id), asset.body, { httpMetadata: { contentType: 'application/pdf', contentDisposition: 'attachment; filename="synthetic-private-name.pdf"' }, customMetadata: { filename: 'synthetic-private-name.pdf' } });
    await database.prepare('INSERT INTO assets (id,owner_id,kind,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(asset.id, owner, 'book', key(asset.id), 'synthetic-private-name.pdf', 'application/pdf', asset.body.length, new Date(time).toISOString()).run();
  };
  await database.prepare('INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(owner, 'Synthetic backup reader', owner + '@example.invalid', 1, start, start).run();
  for (const asset of assets) await putAsset(asset, start - 1000);
  assert.equal((await backupOriginalAssets({ DB: database, BUCKET: bucket })).status, 'disabled');
  assert.equal((await originalBackupStatus(bindings, start)).state, 'never_completed');

  let result = await backupOriginalAssets(bindings, { limit: 1, now: start });
  assert.equal(result.status, 'partial'); assert.equal(result.copied, 1); assert.equal(result.lastCompletedAt, null);
  assert.equal((await state()).cursor, assets[0].id);
  const firstScanStartedAt = (await state()).scanStartedAt;
  let health = await originalBackupStatus(bindings, start);
  assert.equal(health.state, 'never_completed'); assert.equal(health.pending, true);
  assert.equal(JSON.stringify(health).includes(assets[0].id), false, 'Operational health never exposes a file cursor');
  const saved = await backupBucket.head(key(assets[0].id));
  assert.equal(saved.size, body.length); assert.deepEqual(saved.customMetadata ?? {}, {});
  assert.deepEqual(saved.httpMetadata, { contentType: 'application/pdf' }, 'Private filenames and original metadata are not copied');
  const newer = { id: 'as_00_' + suffix, body: new TextEncoder().encode('A later synthetic original') };
  await putAsset(newer, firstScanStartedAt + 1000);

  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const putting = new Promise(resolve => { reached = resolve; });
  const uncertainBackup = { put: async (...args) => { reached(); await gate; await backupBucket.put(...args); throw new Error('Synthetic lost copy acknowledgement'); } };
  const copying = backupOriginalAssets({ ...bindings, BACKUP_BUCKET: uncertainBackup }, { limit: 1, now: start + 2000 });
  await putting;
  assert.equal((await backupOriginalAssets(bindings, { now: start + 2000 })).status, 'busy', 'A second maintenance worker cannot claim a live lease');
  release(); result = await copying;
  assert.equal(result.status, 'failed'); assert.equal((await state()).cursor, assets[0].id);
  assert.equal((await state()).completedAt, null, 'A lost copy response cannot advance freshness');
  assert.equal((await originalBackupStatus(bindings, start + 3000)).state, 'failed');
  assert.equal((await backupOriginalAssets(bindings, { now: start + 3000 })).status, 'waiting', 'Copy failures back off durably');
  const retryAt = (await state()).nextAttemptAt + 1;
  result = await backupOriginalAssets(bindings, { limit: 1, now: retryAt });
  assert.equal(result.status, 'partial'); assert.equal((await state()).cursor, assets[1].id);
  result = await backupOriginalAssets(bindings, { limit: 1, now: retryAt + 1000 });
  assert.equal(result.status, 'complete'); assert.equal((await state()).lastScanFiles, 3);
  assert.equal(await backupBucket.head(key(newer.id)), null, 'A file committed after the scan cutoff waits for the next cycle');
  health = await originalBackupStatus(bindings, start + 72_000);
  assert.equal(health.state, 'current'); assert.equal(health.coveredScanStartedAt, firstScanStartedAt);
  assert.equal((await backupOriginalAssets(bindings, { now: start + 73_000 })).status, 'waiting');
  assert.equal((await originalBackupStatus(bindings, start + 31 * 60 * 60_000)).state, 'stale', 'Freshness measures a completed scan’s coverage, not recent row writes');
  report('Original-file backup checkpoints preserve private metadata boundaries, resume after ambiguous copy failures and report freshness only after a complete bounded scan');

  // Simulate lost primary bytes while the database still references them.
  // Restore this synthetic file from the actual backup body, after an explicit
  // erasure-ledger check. A real restore must do this in a private staging setup.
  await bucket.delete(key(assets[1].id));
  const next = firstScanStartedAt + ORIGINAL_BACKUP_INTERVAL_MS + 1000;
  result = await backupOriginalAssets(bindings, { now: next });
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'SOURCE_MISSING');
  assert.equal((await state()).cursor, assets[0].id);
  assert.equal((await state()).completedScanStartedAt, firstScanStartedAt, 'An incomplete new pass leaves previous coverage unchanged');
  const restorable = await database.prepare(`SELECT a.object_key FROM assets a WHERE a.id=?
    AND EXISTS(SELECT 1 FROM auth_user u WHERE u.id=a.owner_id)
    AND NOT EXISTS(SELECT 1 FROM account_erasure_ledger e WHERE e.owner_id=a.owner_id)
    AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs d WHERE d.owner_id=a.owner_id)`).bind(assets[1].id).first();
  assert.ok(restorable);
  const recovery = await backupBucket.get(restorable.object_key);
  assert.ok(recovery); assert.deepEqual(new Uint8Array(await (await backupBucket.get(restorable.object_key)).arrayBuffer()), body);
  await bucket.put(restorable.object_key, recovery.body, { httpMetadata: { contentType: 'application/pdf' } });
  assert.deepEqual(new Uint8Array(await (await bucket.get(restorable.object_key)).arrayBuffer()), body, 'Recovered bytes match the synthetic original exactly');
  result = await backupOriginalAssets(bindings, { now: (await state()).nextAttemptAt + 1 });
  assert.equal(result.status, 'complete'); assert.equal((await state()).lastScanFiles, 4);
  assert.ok(await backupBucket.head(key(newer.id)));
  report('Missing primary files stop backup success; a local isolated restore reads the saved copy and reproduces synthetic original bytes exactly');

  // Hold a worker past its lease while a second one completes the same pass.
  // The late immutable copy is harmless, but its obsolete checkpoint cannot
  // move the cursor backwards or overwrite the newer completion timestamp.
  let releaseLate, reachedLate;
  const lateGate = new Promise(resolve => { releaseLate = resolve; });
  const latePutting = new Promise(resolve => { reachedLate = resolve; });
  const delayedBackup = { put: async (...args) => { reachedLate(); await lateGate; return backupBucket.put(...args); } };
  const later = (await state()).completedScanStartedAt + ORIGINAL_BACKUP_INTERVAL_MS + 1000;
  const oldWorker = backupOriginalAssets({ ...bindings, BACKUP_BUCKET: delayedBackup }, { limit: 1, now: later });
  await latePutting;
  result = await backupOriginalAssets(bindings, { now: later + 11 * 60_000 });
  assert.equal(result.status, 'complete');
  const newerCompletion = await state();
  releaseLate(); assert.equal((await oldWorker).status, 'busy');
  assert.deepEqual(await state(), newerCompletion, 'An expired worker cannot overwrite the later successful checkpoint');
  report('Backup leases exclude parallel work and fence expired workers so a late storage response cannot overwrite a newer completed scan');

  const retained = await backupBucket.head(key(assets[0].id));
  await database.prepare('INSERT INTO account_erasure_ledger (owner_id,requested_at,expires_at) VALUES (?,?,?)')
    .bind(owner, later, later + 35 * 24 * 60 * 60_000).run();
  result = await backupOriginalAssets(bindings, { now: (await state()).nextAttemptAt + 1 });
  assert.equal(result.status, 'complete'); assert.equal(result.copied, 0);
  assert.equal((await state()).lastScanFiles, 0);
  assert.equal((await backupBucket.head(key(assets[0].id))).version, retained.version, 'An erased account’s retained recovery copy is not refreshed even if an old database still references it');
  assert.equal(await database.prepare(`SELECT a.object_key FROM assets a WHERE a.id=?
    AND NOT EXISTS(SELECT 1 FROM account_erasure_ledger e WHERE e.owner_id=a.owner_id)`).bind(assets[0].id).first(), null,
  'The restore selection must refuse records covered by the erasure ledger');
  report('Erasure-ledger entries stop copying from an old/restored database and block recovery selection; retained backup bytes await the separately configured lifecycle expiry');
}
