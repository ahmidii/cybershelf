import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  auditExitCode, fetchMetadataPrivately, metadataCommandEnvironment, parseBackupRetention,
  parseCustomDomainPrivacy, parseManagedDomainPrivacy,
  runOperationsAudit, summarizeOperationsEvidence,
} from '../scripts/verify-cloudflare-operations.mjs';

const ACCOUNT = 'a'.repeat(32);
const EXPECTED = { databaseId: '11111111-1111-4111-8111-111111111111', databaseName: 'fixture-db', crons: ['*/5 * * * *'] };
const json = value => ({ status: 0, stdout: JSON.stringify(value) });
const metadata = result => ({ ok: true, status: 200, body: { success: true, result } });
const privateDomain = { status: 0, stdout: 'Public access via the r2.dev URL is disabled.\n' };
const noDomains = { status: 0, stdout: 'There are no custom domains connected to this bucket.\n' };
const lifecycle = { status: 0, stdout: 'name: expire-historical-originals\nenabled: Yes\nprefix: (all prefixes)\naction: Expire objects after 30 days\n' };

function validEvidence() {
  return {
    whoami: json({ loggedIn: true, email: 'private@example.invalid', accounts: [{ id: ACCOUNT, name: 'private account' }] }),
    d1Info: json({ uuid: EXPECTED.databaseId, name: EXPECTED.databaseName }),
    timeTravel: json({ bookmark: '00000001-00000002-00000003-00000004' }),
    managedDomain: privateDomain, customDomains: noDomains,
    backupManagedDomain: privateDomain, backupCustomDomains: noDomains, backupLifecycle: lifecycle,
    schedules: metadata({ schedules: [{ cron: '*/5 * * * *' }] }),
    scriptSettings: metadata({ observability: { enabled: true, logs: { enabled: true, persist: true, invocation_logs: false }, traces: { enabled: false } } }),
    account: metadata({ settings: { enforce_twofactor: true } }),
    secretNames: json([{ name: 'MODERATOR_USER_IDS', type: 'secret_text' }]),
    health: { ok: true, status: 200, body: { accounts: true, email: false, operations: { moderationConfigured: true, maintenanceConfigured: true, maintenanceRecent: true, backupConfigured: true, backupRecent: true } } },
  };
}

test('operations evidence confirms returned metadata without declaring untested production recovery successful', () => {
  const report = summarizeOperationsEvidence(validEvidence(), EXPECTED);
  for (const check of ['expectedD1Database', 'd1ProductionTimeTravel', 'r2ManagedDomainPrivate', 'r2CustomDomainsPrivate', 'maintenanceSchedule', 'workerLogsEnabled', 'workerLogsPersisted', 'accountRequiresTwoFactor', 'moderatorConfigured', 'maintenanceRecent', 'backupRecent', 'backupDestinationPrivate', 'backupMaximumRetentionPolicy']) {
    assert.equal(report.checks[check].status, 'verified', check);
  }
  assert.equal(report.checks.originalFileBackupRestoreVerified.status, 'unknown');
  assert.equal(report.checks.externalAlertDeliveryVerified.status, 'unknown');
  assert.equal(report.checks.d1RetentionWindowReviewed.status, 'unknown');
  assert.equal(report.productionEvidenceComplete, false);
  assert.equal(auditExitCode(report), 2);
  const rendered = JSON.stringify(report);
  for (const privateValue of ['private@example.invalid', ACCOUNT, 'private account', EXPECTED.databaseId, '00000001-00000002-00000003-00000004']) assert.ok(!rendered.includes(privateValue));
});

test('permission failures, malformed metadata and a wrong database never become positive evidence', () => {
  const evidence = validEvidence();
  const rejected = { status: 1, stdout: JSON.stringify({ loggedIn: true, uuid: EXPECTED.databaseId, name: EXPECTED.databaseName, bookmark: '00000001-00000002' }) + '\nPublic access via the r2.dev URL is disabled.', stderr: 'sensitive provider body' };
  for (const key of ['whoami', 'd1Info', 'timeTravel', 'managedDomain', 'customDomains', 'secretNames', 'backupManagedDomain', 'backupCustomDomains', 'backupLifecycle']) evidence[key] = rejected;
  for (const key of ['schedules', 'scriptSettings', 'account', 'health']) evidence[key] = { ok: false, status: 403, body: validEvidence()[key].body };
  const report = summarizeOperationsEvidence(evidence, EXPECTED);
  assert.ok(Object.values(report.checks).every(check => check.status === 'unknown'));
  assert.equal(auditExitCode(report), 2);
  const wrong = summarizeOperationsEvidence({ ...validEvidence(), d1Info: json({ uuid: 'another-database', name: EXPECTED.databaseName }) }, EXPECTED);
  assert.equal(wrong.checks.expectedD1Database.status, 'attention');
  assert.equal(wrong.checks.d1ProductionTimeTravel.status, 'unknown');
  assert.equal(auditExitCode(wrong), 1);
  assert.equal(summarizeOperationsEvidence({ ...validEvidence(), schedules: metadata({ schedules: [] }) }, EXPECTED).checks.maintenanceSchedule.status, 'attention');
  assert.equal(summarizeOperationsEvidence({ ...validEvidence(), scriptSettings: metadata({ observability: {} }) }, EXPECTED).checks.workerLogsEnabled.status, 'unknown');
});

test('both R2 access paths must be private and lifecycle must expire all backup prefixes within policy', () => {
  assert.equal(parseManagedDomainPrivacy(privateDomain), true);
  assert.equal(parseManagedDomainPrivacy({ status: 0, stdout: "Public access is enabled at 'https://fixture.r2.dev'." }), false);
  assert.equal(parseManagedDomainPrivacy({ status: 0, stdout: 'No useful status returned.' }), undefined);
  assert.equal(parseCustomDomainPrivacy(noDomains), true);
  assert.equal(parseCustomDomainPrivacy({ status: 0, stdout: 'domain: files.example.invalid\nenabled: No\n\ndomain: another.example.invalid\nenabled: Yes\n' }), false);
  assert.equal(parseCustomDomainPrivacy({ status: 0, stdout: 'domain: files.example.invalid\n' }), undefined);
  assert.equal(parseBackupRetention(lifecycle), true);
  for (const replacement of [lifecycle.stdout.replace('30 days', '60 days'), lifecycle.stdout.replace('(all prefixes)', 'only-one-prefix/'), lifecycle.stdout.replace('enabled: Yes', 'enabled: No')]) {
    assert.equal(parseBackupRetention({ status: 0, stdout: replacement }), false);
  }
  assert.equal(parseBackupRetention({ status: 0, stdout: 'No recognized lifecycle result.' }), undefined);
  const report = summarizeOperationsEvidence({ ...validEvidence(), backupCustomDomains: { status: 0, stdout: 'domain: backup.example.invalid\nenabled: Yes\n' } }, EXPECTED);
  assert.equal(report.checks.backupDestinationPrivate.status, 'attention');
});

test('audit executes only read-only metadata commands and never forwards its token to public health', async () => {
  const commands = [], requests = [];
  const sensitive = 'fixture-secret-that-must-not-appear-in-the-report';
  const evidence = validEvidence();
  const config = { name: 'fixture-worker', account_id: ACCOUNT, vars: { APP_ORIGIN: 'https://fixture.example.invalid' },
    d1_databases: [{ binding: 'DB', database_id: EXPECTED.databaseId, database_name: EXPECTED.databaseName }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: 'fixture-files' }, { binding: 'BACKUP_BUCKET', bucket_name: 'fixture-backups' }], triggers: { crons: EXPECTED.crons } };
  const report = await runOperationsAudit({ config, env: { CLOUDFLARE_API_TOKEN: sensitive },
    runPrivate(args) {
      commands.push(args);
      if (args[0] === 'whoami') return evidence.whoami;
      if (args[0] === 'd1') return args[1] === 'info' ? evidence.d1Info : evidence.timeTravel;
      if (args[0] === 'secret') return evidence.secretNames;
      return args[2] === 'dev-url' ? privateDomain : args[2] === 'domain' ? noDomains : lifecycle;
    },
    fetchMetadata(url, options) {
      requests.push({ url, options });
      if (url.includes('/api/health')) { assert.equal(options.token, undefined); return evidence.health; }
      assert.equal(options.token, sensitive);
      if (url.endsWith('/script-settings')) return evidence.scriptSettings;
      if (url.endsWith('/schedules')) return evidence.schedules;
      assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT);
      return evidence.account;
    },
  });
  assert.equal(commands.length, 9);
  for (const command of commands) {
    const verb = command.slice(0, -2).join(' ');
    assert.match(verb, /^(whoami --json|d1 info DB --json|d1 time-travel info DB --json|secret list --format json|r2 bucket (dev-url get|domain list|lifecycle list) fixture-(files|backups))$/);
  }
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => !request.url.endsWith('/settings')));
  assert.equal(report.checks.expectedD1Database.confirmed, true);
  assert.ok(!JSON.stringify(report).includes(sensitive));
});

test('ambiguous account selection does not probe resources or assume local configuration is deployed', async () => {
  const commands = [], requests = [];
  const report = await runOperationsAudit({ config: { name: 'fixture-worker', d1_databases: [{ binding: 'DB', database_id: EXPECTED.databaseId, database_name: EXPECTED.databaseName }], observability: { enabled: true } },
    env: { CLOUDFLARE_API_TOKEN: 'unused-fixture-token' },
    runPrivate(args) { commands.push(args); return json({ loggedIn: true, accounts: [{ id: ACCOUNT }, { id: 'b'.repeat(32) }] }); },
    fetchMetadata(url) { requests.push(url); throw new Error('Should not fetch an ambiguous account'); },
  });
  assert.equal(commands.length, 1);
  assert.equal(requests.length, 0);
  assert.equal(report.checks.expectedD1Database.status, 'unknown');
  assert.equal(report.checks.workerLogsEnabled.status, 'unknown');
});

test('private metadata transport refuses token redirects, drops error bodies and bounds JSON reads', async () => {
  let calls = 0, bodyRead = false, cancelled = false;
  const errorResult = await fetchMetadataPrivately('https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT, { token: 'test-token', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    return { ok: false, status: 403, body: { cancel: async () => { cancelled = true; }, getReader() { bodyRead = true; throw new Error('Do not read provider errors'); } } };
  } });
  assert.deepEqual(errorResult, { ok: false, status: 403 });
  assert.equal(bodyRead, false);
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  const rejected = await fetchMetadataPrivately('https://another.example.invalid/collect', { token: 'test-token', fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(rejected.ok, false);
  const oversized = await fetchMetadataPrivately('https://fixture.example.invalid/api/health', { fetchImpl: async () => new Response('x'.repeat(300 * 1024), { status: 200 }) });
  assert.equal(oversized.body, null);
});

test('metadata commands use the supplied CI token instead of a competing global key and fixed production API origin', () => {
  const original = { CLOUDFLARE_API_TOKEN: 'ci-fixture-token', CLOUDFLARE_API_KEY: 'global-fixture-key', CLOUDFLARE_EMAIL: 'private@example.invalid', CF_API_KEY: 'old-global-key', CF_EMAIL: 'old@example.invalid', CF_API_TOKEN: 'old-token', CLOUDFLARE_API_BASE_URL: 'https://unexpected.example.invalid', CF_API_BASE_URL: 'https://unexpected.example.invalid', CLOUDFLARE_BASE_URL: 'https://unexpected.example.invalid', NODE_OPTIONS: '--inspect', WRANGLER_WRITE_LOGS: 'true', WRANGLER_LOG: 'debug' };
  const selected = metadataCommandEnvironment(original);
  assert.equal(selected.CLOUDFLARE_API_TOKEN, original.CLOUDFLARE_API_TOKEN);
  for (const key of ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_KEY', 'CF_EMAIL', 'CF_API_TOKEN', 'CF_API_BASE_URL', 'NODE_OPTIONS']) assert.equal(selected[key], undefined);
  assert.equal(selected.CLOUDFLARE_API_BASE_URL, 'https://api.cloudflare.com/client/v4');
  assert.equal(selected.CLOUDFLARE_BASE_URL, 'https://api.cloudflare.com/client/v4');
  assert.equal(selected.WRANGLER_WRITE_LOGS, 'false');
  assert.equal(selected.WRANGLER_LOG, 'log');
  assert.equal(original.CLOUDFLARE_API_KEY, 'global-fixture-key', 'The caller environment is not mutated');
});

// This rehearsal operates exclusively on disposable SQLite and a Map of
// synthetic bytes. It cannot connect to D1, R2, Wrangler or a network service.
const fixtureDatabases = new WeakSet();
function freshDatabase() {
  const db = new DatabaseSync(':memory:');
  fixtureDatabases.add(db);
  db.exec('PRAGMA foreign_keys=ON');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const migration of journal.entries) db.exec(readFileSync(new URL('../drizzle/' + migration.tag + '.sql', import.meta.url), 'utf8'));
  return db;
}

function insertRow(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
}

function eraseRestoredOwner(db, ownerId, objects) {
  const keys = db.prepare('SELECT object_key FROM assets WHERE owner_id=? UNION SELECT object_key FROM asset_transfers WHERE owner_id=?').all(ownerId, ownerId);
  for (const { object_key } of keys) objects.delete(object_key);
  db.prepare('DELETE FROM moderation_actions WHERE moderator_id=? OR target_owner_id=? OR report_id IN (SELECT id FROM moderation_reports WHERE reporter_id=? OR target_owner_id=?)').run(ownerId, ownerId, ownerId, ownerId);
  db.prepare('DELETE FROM moderation_reports WHERE reporter_id=? OR target_owner_id=?').run(ownerId, ownerId);
  db.prepare('DELETE FROM reading_comments WHERE owner_id=? OR post_id IN (SELECT id FROM reading_posts WHERE owner_id=?)').run(ownerId, ownerId);
  for (const table of ['reading_posts', 'publications', 'public_profiles', 'reading_events', 'libraries', 'assets', 'asset_transfers', 'account_deletion_jobs']) db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).run(ownerId);
  db.prepare('DELETE FROM auth_verification WHERE value=? OR identifier IN (SELECT email FROM auth_user WHERE id=?)').run(ownerId, ownerId);
  db.prepare('DELETE FROM auth_user WHERE id=?').run(ownerId);
}

function reconcileDisposableRestore(candidate, current, restoredObjects) {
  assert.ok(fixtureDatabases.has(candidate), 'Rehearsal may only touch a registered disposable database');
  assert.ok(fixtureDatabases.has(current), 'Rehearsal may only read a registered disposable database');
  assert.ok(restoredObjects instanceof Map, 'Rehearsal may only touch synthetic file bytes');
  // Export this evidence BEFORE replacing/restoring production. The restored
  // snapshot is never the authority for deletions, credentials or recovery keys.
  const liveLedger = current.prepare('SELECT * FROM account_erasure_ledger').all();
  const liveUsers = current.prepare('SELECT * FROM auth_user').all();
  const currentIds = new Set(liveUsers.map(user => user.id));
  const erasedIds = new Set(liveLedger.map(row => row.owner_id));
  for (const { id } of candidate.prepare('SELECT id FROM auth_user').all()) {
    assert.ok(currentIds.has(id) || erasedIds.has(id), 'Unknown identity state blocks promotion');
  }
  candidate.exec('BEGIN IMMEDIATE');
  try {
    for (const row of liveLedger) candidate.prepare('INSERT INTO account_erasure_ledger (owner_id,requested_at,expires_at) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET requested_at=MIN(requested_at,excluded.requested_at),expires_at=MAX(expires_at,excluded.expires_at)').run(row.owner_id, row.requested_at, row.expires_at);
    for (const { owner_id } of candidate.prepare('SELECT owner_id FROM account_erasure_ledger').all()) eraseRestoredOwner(candidate, owner_id, restoredObjects);
    candidate.exec('DELETE FROM auth_session; DELETE FROM auth_verification; DELETE FROM auth_account; DELETE FROM account_recovery_keys');
    // Avoid username/email uniqueness collisions when identities changed since
    // the backup. Only an offline candidate may use these temporary addresses.
    candidate.exec("UPDATE auth_user SET username=NULL,email='restore-fixture-' || id || '@staging.invalid'");
    for (const row of liveUsers) {
      if (erasedIds.has(row.id)) continue;
      const columns = Object.keys(row);
      candidate.prepare(`INSERT INTO auth_user (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(column => column !== 'id').map(column => `${column}=excluded.${column}`).join(',')}`).run(...Object.values(row));
    }
    for (const table of ['auth_account', 'account_recovery_keys']) {
      for (const row of current.prepare(`SELECT * FROM ${table}`).all()) if (!erasedIds.has(row.user_id)) insertRow(candidate, table, row);
    }
    // Do not revive old shares/posts that could have been withdrawn after the
    // snapshot. Republishing requires a fresh reader choice after recovery.
    candidate.exec('DELETE FROM reading_comments; DELETE FROM reading_posts; DELETE FROM publications; DELETE FROM public_profiles; DELETE FROM reader_activity');
    // Restore current blocking/moderation controls, not their older versions.
    for (const table of ['reader_blocks', 'moderation_hidden', 'account_suspensions']) {
      candidate.exec(`DELETE FROM ${table}`);
      for (const row of current.prepare(`SELECT * FROM ${table}`).all()) insertRow(candidate, table, row);
    }
    assert.deepEqual(candidate.prepare('PRAGMA foreign_key_check').all(), []);
    candidate.exec('COMMIT');
  } catch (error) { candidate.exec('ROLLBACK'); throw error; }
}

test('disposable restore rehearsal imports current erasures, preserves security state and original file linkage before promotion', () => {
  const runtime = fileURLToPath(new URL('../.sites-runtime/', import.meta.url));
  mkdirSync(runtime, { recursive: true });
  const scratch = mkdtempSync(resolve(runtime, 'restore-rehearsal-'));
  const current = freshDatabase();
  let candidate;
  const stamp = 1_800_000_000_000, iso = new Date(stamp).toISOString();
  const originalBytes = new TextEncoder().encode('synthetic EPUB original, edition 1');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const backupObjects = new Map([['objects/keep-original', originalBytes], ['objects/erase-original', new Uint8Array([1, 2, 3])], ['objects/erase-public-art', new Uint8Array([4, 5])]]);
  try {
    for (const id of ['keep', 'erase']) {
      insertRow(current, 'auth_user', { id, name: id, email: id + '@accounts.invalid', username: id, email_verified: 0, created_at: stamp, updated_at: stamp });
      insertRow(current, 'auth_account', { id: id + '-credential', account_id: id, provider_id: 'credential', user_id: id, password: 'old-' + id + '-hash', created_at: stamp, updated_at: stamp });
      insertRow(current, 'account_recovery_keys', { user_id: id, key_hash: 'old-' + id + '-recovery-digest', created_at: stamp, updated_at: stamp });
      insertRow(current, 'auth_session', { id: id + '-session', token: id + '-session-token', user_id: id, expires_at: stamp + 86_400_000, created_at: stamp, updated_at: stamp });
      insertRow(current, 'auth_verification', { id: id + '-reset', identifier: 'reset-password:' + id + '-fixture', value: id, expires_at: stamp + 60000, created_at: stamp, updated_at: stamp });
      insertRow(current, 'libraries', { owner_id: id, state: JSON.stringify({ schemaVersion: 1, profile: { name: id, bio: '' }, shelves: [], books: [{ id: 'book', title: 'Synthetic book', author: 'Fixture author', coverUrl: '', color: '#abcdef', status: 'reading', progress: 20, rating: null, review: '', notes: '', addedAt: iso, sources: [{ id: 'file-source', kind: 'file', label: 'Private EPUB', assetId: id + '-original' }] }] }), version: 1, updated_at: iso });
      insertRow(current, 'assets', { id: id + '-original', owner_id: id, kind: 'book', object_key: 'objects/' + id + '-original', filename: 'fixture.epub', mime: 'application/epub+zip', size: backupObjects.get('objects/' + id + '-original').byteLength, created_at: iso });
      insertRow(current, 'public_profiles', { id: id + '-profile', owner_id: id, shelf_id: 'shelf', snapshot: '{}', image_ids: '[]', published_at: iso, updated_at: iso });
      insertRow(current, 'publications', { id: id + '-share', owner_id: id, shelf_id: 'shelf', snapshot: '{}', image_ids: '[]', published_at: iso, updated_at: iso });
      insertRow(current, 'reading_posts', { id: id + '-post', owner_id: id, profile_id: id + '-profile', book_id: 'book', entry_id: 'entry', snapshot: '{}', image_ids: '[]', published_at: iso, updated_at: iso });
    }
    insertRow(current, 'assets', { id: 'erase-public-art', owner_id: 'erase', kind: 'image', object_key: 'objects/erase-public-art', filename: 'fixture.png', mime: 'image/png', size: 2, created_at: iso });
    insertRow(current, 'moderation_reports', { id: 'report', reporter_id: 'erase', target_kind: 'post', target_id: 'keep-post', target_owner_id: 'keep', reason: 'harassment', details: 'synthetic private report', public_snapshot: 'synthetic excerpt', status: 'open', created_at: iso, updated_at: iso });
    insertRow(current, 'moderation_actions', { id: 'action', report_id: 'report', moderator_id: 'keep', target_owner_id: 'keep', action: 'dismiss', note: 'synthetic quote of erased reader', created_at: iso });
    const snapshotPath = resolve(scratch, 'synthetic-backup.sqlite');
    current.prepare('VACUUM INTO ?').run(snapshotPath);
    current.prepare('UPDATE auth_account SET password=?,updated_at=? WHERE user_id=?').run('current-keep-hash', stamp + 1000, 'keep');
    current.prepare('UPDATE account_recovery_keys SET key_hash=?,updated_at=? WHERE user_id=?').run('current-keep-recovery-digest', stamp + 1000, 'keep');
    current.prepare('UPDATE auth_user SET username=?,updated_at=? WHERE id=?').run('keep-current', stamp + 1000, 'keep');
    insertRow(current, 'account_erasure_ledger', { owner_id: 'erase', requested_at: stamp + 2000, expires_at: stamp + 2000 + 35 * 86_400_000 });
    eraseRestoredOwner(current, 'erase', new Map(backupObjects));

    // Actual rollback from a SQLite backup file, using only APIs available in
    // the repository's supported Node 22.13+ baseline.
    const restorePath = resolve(scratch, 'synthetic-restored.sqlite');
    copyFileSync(snapshotPath, restorePath);
    candidate = new DatabaseSync(restorePath);
    fixtureDatabases.add(candidate);
    candidate.exec('PRAGMA foreign_keys=ON');
    assert.equal(candidate.prepare('SELECT COUNT(*) AS n FROM auth_user WHERE id=?').get('erase').n, 1, 'The uncorrected backup really does resurrect a deleted reader');
    assert.equal(candidate.prepare('SELECT password FROM auth_account WHERE user_id=?').get('keep').password, 'old-keep-hash');
    const restoredObjects = new Map(backupObjects);
    const preservedLedger = current.prepare('SELECT * FROM account_erasure_ledger WHERE owner_id=?').get('erase');
    current.prepare('DELETE FROM account_erasure_ledger WHERE owner_id=?').run('erase');
    assert.throws(() => reconcileDisposableRestore(candidate, current, restoredObjects), /Unknown identity state blocks promotion/, 'Missing latest erasure evidence must halt promotion');
    assert.equal(restoredObjects.size, 3, 'A blocked candidate has not changed the staged files');
    insertRow(current, 'account_erasure_ledger', preservedLedger);
    reconcileDisposableRestore(candidate, current, restoredObjects);

    for (const table of ['auth_user', 'auth_account', 'account_recovery_keys', 'libraries', 'assets']) {
      const column = table === 'auth_user' ? 'id' : ['auth_account', 'account_recovery_keys'].includes(table) ? 'user_id' : 'owner_id';
      assert.equal(candidate.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get('erase').n, 0, table);
    }
    for (const table of ['auth_session', 'auth_verification', 'moderation_reports', 'moderation_actions', 'publications', 'public_profiles', 'reading_posts']) assert.equal(candidate.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    assert.equal(candidate.prepare('SELECT password FROM auth_account WHERE user_id=?').get('keep').password, 'current-keep-hash');
    assert.equal(candidate.prepare('SELECT key_hash FROM account_recovery_keys WHERE user_id=?').get('keep').key_hash, 'current-keep-recovery-digest');
    assert.equal(candidate.prepare('SELECT username FROM auth_user WHERE id=?').get('keep').username, 'keep-current');
    assert.equal(candidate.prepare('SELECT expires_at FROM account_erasure_ledger WHERE owner_id=?').get('erase').expires_at, stamp + 2000 + 35 * 86_400_000);
    const book = JSON.parse(candidate.prepare('SELECT state FROM libraries WHERE owner_id=?').get('keep').state).books[0];
    const asset = candidate.prepare('SELECT * FROM assets WHERE id=? AND owner_id=?').get(book.sources[0].assetId, 'keep');
    assert.ok(asset);
    assert.equal(digest(restoredObjects.get(asset.object_key)), digest(originalBytes), 'Library → asset → original bytes survives restoration');
    assert.equal(restoredObjects.size, 1);
    assert.ok(!restoredObjects.has('objects/erase-original'));
    assert.ok(!restoredObjects.has('objects/erase-public-art'));
    assert.throws(() => insertRow(candidate, 'libraries', { owner_id: 'erase', state: '{}', version: 1, updated_at: iso }), /Account is unavailable/);
    assert.throws(() => insertRow(candidate, 'auth_verification', { id: 'stale', identifier: 'reset-password:stale', value: 'erase', expires_at: stamp + 10000, created_at: stamp, updated_at: stamp }), /Account is unavailable/);
    assert.deepEqual(candidate.prepare('PRAGMA foreign_key_check').all(), []);
    // A repeated reconciliation is safe and does not remove the surviving file.
    reconcileDisposableRestore(candidate, current, restoredObjects);
    assert.equal(restoredObjects.size, 1);
    assert.equal(candidate.prepare('SELECT COUNT(*) AS n FROM account_erasure_ledger').get().n, 1);
  } finally { current.close(); candidate?.close(); rmSync(scratch, { recursive: true, force: true }); }
});
