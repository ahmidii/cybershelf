import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Run the exact production helpers against the harness's disposable real D1/R2.
// The module has no runtime imports or global production bindings.
const code = ts.transpileModule(readFileSync(new URL('./asset-transfers.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { reserveAssetTransfer, writeReservedAsset, cleanupAssetTransfers, assetUsage, queueUnusedAssetRemoval,
  limitUploadAttempts, AssetTransferError, ACCOUNT_ASSET_LIMIT_BYTES, ACCOUNT_ASSET_LIMIT_COUNT } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

export async function runAssetTransferIntegration({ base, fetch: requestFetch, database, bucket, report }) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12), bindings = { DB: database, BUCKET: bucket, BETTER_AUTH_SECRET: 'an-ephemeral-upload-limiter-secret-with-no-production-use' };
  const account = async label => {
    const response = await requestFetch(base + '/api/auth/sign-up/username', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'cf-connecting-ip': '198.18.5.' + (++account.address) },
      body: JSON.stringify({ username: label + '_' + suffix, password: 'A synthetic file quota test passphrase' }) });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).user.id;
  };
  account.address = 0;
  const byteOwner = await account('bytes'), countOwner = await account('counts'), flightOwner = await account('flight'), failureOwner = await account('failure'), deletedOwner = await account('removed');
  const body = new TextEncoder().encode('%PDF-1.7\nprivate synthetic original');
  const file = { kind: 'book', filename: 'private-original.pdf', mime: 'application/pdf' };
  const insertAsset = (id, owner, size) => database.prepare('INSERT INTO assets (id, owner_id, kind, object_key, filename, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, owner, 'book', 'private/' + id, 'quota-fixture.pdf', 'application/pdf', size, new Date().toISOString());

  // Twenty legal-sized metadata records simulate a nearly full account without
  // storing 500 MiB in the disposable bucket merely to test the accounting.
  await database.batch(Array.from({ length: 20 }, (_, index) => insertAsset('as_bytes_' + suffix + '_' + index, byteOwner, 25 * 1024 * 1024 - (index === 19 ? 100 : 0))));
  const bytesRace = await Promise.allSettled([reserveAssetTransfer(bindings, byteOwner, 60), reserveAssetTransfer(bindings, byteOwner, 60)]);
  assert.equal(bytesRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(bytesRace.filter(result => result.status === 'rejected' && result.reason instanceof AssetTransferError && result.reason.status === 413).length, 1);
  const byteUsage = await assetUsage(bindings, byteOwner);
  assert.equal(byteUsage.usedBytes, ACCOUNT_ASSET_LIMIT_BYTES - 40);
  assert.equal(byteUsage.pendingFiles, 1);
  await database.prepare(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < ?)
    INSERT INTO assets (id, owner_id, kind, object_key, filename, mime, size, created_at)
    SELECT ? || n, ?, 'image', ? || n, 'quota-fixture.png', 'image/png', 8, ? FROM sequence`)
    .bind(ACCOUNT_ASSET_LIMIT_COUNT - 1, 'as_count_' + suffix + '_', countOwner, 'private/as_count_' + suffix + '_', new Date().toISOString()).run();
  const countRace = await Promise.allSettled([reserveAssetTransfer(bindings, countOwner, 8), reserveAssetTransfer(bindings, countOwner, 8)]);
  assert.equal(countRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await assetUsage(bindings, countOwner)).usedCount, 1000);
  const flights = await Promise.allSettled(Array.from({ length: 5 }, () => reserveAssetTransfer(bindings, flightOwner, body.length)));
  assert.equal(flights.filter(result => result.status === 'fulfilled').length, 4);
  assert.equal(flights.filter(result => result.status === 'rejected' && result.reason.code === 'UPLOAD_BUSY').length, 1);
  report('Atomic D1 reservations enforce byte, file-count and in-flight limits under simultaneous requests');

  const kept = await reserveAssetTransfer(bindings, failureOwner, body.length);
  await writeReservedAsset(bindings, kept, body, file);
  assert.equal((await assetUsage(bindings, failureOwner)).pendingFiles, 0, 'Finalization replaces the reservation without double-counting');
  assert.equal((await assetUsage(bindings, failureOwner)).usedBytes, body.length);
  assert.equal(await (await bucket.get(kept.object_key)).text(), new TextDecoder().decode(body));
  assert.equal(await queueUnusedAssetRemoval(bindings, failureOwner, kept.id, null), true);
  const unavailableBucket = { put: (...args) => bucket.put(...args), delete: async () => { throw new Error('synthetic bucket deletion outage'); } };
  assert.equal((await cleanupAssetTransfers({ ...bindings, BUCKET: unavailableBucket }, { ownerId: failureOwner })).failed, 1);
  assert.equal((await assetUsage(bindings, failureOwner)).usedBytes, body.length, 'Pending erasure keeps its quota until storage confirms removal');
  assert.equal(await database.prepare('SELECT id FROM assets WHERE id = ?').bind(kept.id).first(), null, 'Private access is revoked even when storage cleanup is pending');
  await cleanupAssetTransfers(bindings, { ownerId: failureOwner, now: Date.now() + 3_600_000 });
  assert.equal(await bucket.get(kept.object_key), null);
  assert.equal((await assetUsage(bindings, failureOwner)).usedCount, 0);
  report('Committed upload finalization never double-counts quota; failed file removal remains durable and releases quota only after retry');

  const interrupted = await reserveAssetTransfer(bindings, failureOwner, body.length);
  let calls = 0;
  const uncertainBucket = {
    put: async (...args) => { calls++; await bucket.put(...args); throw new Error('synthetic lost storage response'); },
    delete: (...args) => bucket.delete(...args),
  };
  await assert.rejects(writeReservedAsset({ ...bindings, BUCKET: uncertainBucket }, interrupted, body, file), error => error.code === 'UPLOAD_UNAVAILABLE');
  assert.ok(calls >= 2, 'An ambiguous upload is followed by a sealing attempt');
  assert.ok(await database.prepare('SELECT id FROM asset_transfers WHERE id = ?').bind(interrupted.id).first(), 'An unconfirmed cleanup retains its durable record');
  await cleanupAssetTransfers(bindings, { ownerId: failureOwner, now: Date.now() + 3_600_000 });
  const marker = await bucket.head(interrupted.object_key);
  assert.equal(marker.size, 0);
  assert.deepEqual(marker.customMetadata ?? {}, {});
  assert.deepEqual(marker.httpMetadata ?? {}, {});
  assert.equal(await bucket.put(interrupted.object_key, body, { onlyIf: { etagDoesNotMatch: '*' } }), null, 'A late conditional write cannot replace a cancellation marker');
  assert.equal((await assetUsage(bindings, failureOwner)).usedBytes, 0);
  report('Ambiguous upload failures retain cleanup obligations; retries erase bytes and retain only metadata-free zero-byte cancellation barriers');

  const stale = await reserveAssetTransfer(bindings, deletedOwner, body.length);
  let releasePut, signalPut;
  const reachedPut = new Promise(resolve => { signalPut = resolve; });
  const heldPut = new Promise(resolve => { releasePut = resolve; });
  const delayedBucket = { put: async (...args) => { signalPut(); await heldPut; return bucket.put(...args); }, delete: (...args) => bucket.delete(...args) };
  const lateWriter = writeReservedAsset({ ...bindings, BUCKET: delayedBucket }, stale, body, file);
  const completion = lateWriter.then(() => ({ saved: true }), error => ({ error }));
  await reachedPut;
  await database.batch([
    database.prepare("UPDATE asset_transfers SET state = 'cleanup', next_attempt_at = 0 WHERE owner_id = ?").bind(deletedOwner),
    database.prepare('DELETE FROM auth_user WHERE id = ?').bind(deletedOwner),
  ]);
  await cleanupAssetTransfers(bindings, { ownerId: deletedOwner });
  releasePut();
  const stopped = await completion;
  assert.equal(stopped.error?.code, 'UPLOAD_CANCELLED');
  assert.equal(await database.prepare('SELECT id FROM assets WHERE owner_id = ?').bind(deletedOwner).first(), null);
  assert.equal((await bucket.head(stale.object_key)).size, 0);
  await assert.rejects(reserveAssetTransfer(bindings, deletedOwner, body.length), error => error.code === 'ACCOUNT_UNAVAILABLE');
  assert.equal((await assetUsage(bindings, byteOwner)).usedBytes, byteUsage.usedBytes, 'Another account is untouched by deletion cleanup');
  report('Account removal during an in-flight R2 write prevents finalization and later resurrection, while other account files remain isolated');

  const paused = await reserveAssetTransfer(bindings, failureOwner, body.length);
  await database.prepare('INSERT INTO account_suspensions (user_id, reason, created_at) VALUES (?, ?, ?)')
    .bind(failureOwner, 'Synthetic upload-abuse suspension', new Date().toISOString()).run();
  await assert.rejects(reserveAssetTransfer(bindings, failureOwner, body.length), error => error.code === 'ACCOUNT_UNAVAILABLE');
  await assert.rejects(writeReservedAsset(bindings, paused, body, file), error => error.code === 'UPLOAD_CANCELLED');
  assert.equal(await database.prepare('SELECT id FROM assets WHERE id = ?').bind(paused.id).first(), null);
  assert.equal(await bucket.get(paused.object_key), null, 'A reservation made before suspension cannot publish an uploaded original');
  await database.prepare('DELETE FROM account_suspensions WHERE user_id = ?').bind(failureOwner).run();
  report('Suspension denies new reservations and rechecks older reservations before committing a file');

  const expired = flights.find(result => result.status === 'fulfilled').value;
  await database.prepare('UPDATE asset_transfers SET expires_at = 0 WHERE owner_id = ?').bind(flightOwner).run();
  await cleanupAssetTransfers(bindings, { ownerId: flightOwner });
  assert.equal((await assetUsage(bindings, flightOwner)).pendingFiles, 0);
  assert.equal(await bucket.put(expired.object_key, body, { onlyIf: { etagDoesNotMatch: '*' } }), null);
  const limited = new Request(base + '/api/assets', { headers: { 'cf-connecting-ip': '198.19.4.55' } });
  const fixedTime = Math.floor(Date.now() / 60_000) * 60_000 + 500;
  for (let index = 0; index < 30; index++) await limitUploadAttempts(bindings, limited, flightOwner, fixedTime);
  await assert.rejects(limitUploadAttempts(bindings, limited, flightOwner, fixedTime), error => error.code === 'UPLOAD_RATE_LIMITED');
  const counters = await database.prepare('SELECT key FROM account_action_limits').all();
  assert.ok(counters.results.every(row => /^[a-f0-9]{64}$/.test(row.key)));
  report('Expired reservations are reclaimed safely and upload attempt limits persist without raw account or network identifiers');
}
