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

const erasureRetention = 35 * 86_400_000;
const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');

function preserveCommunityErasure(db, row) {
  const previous = db.prepare('SELECT storage_id FROM community_asset_erasures WHERE asset_id=?').get(row.asset_id);
  assert.ok(!previous || previous.storage_id === row.storage_id, 'Conflicting shared storage identity blocks promotion');
  db.prepare('INSERT INTO community_asset_erasures (asset_id,storage_id,requested_at,expires_at) VALUES (?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET requested_at=MIN(requested_at,excluded.requested_at),expires_at=MAX(expires_at,excluded.expires_at)').run(row.asset_id, row.storage_id, row.requested_at, row.expires_at);
}

function eraseRestoredOwner(db, ownerId, objects) {
  const erased = db.prepare('SELECT requested_at FROM account_erasure_ledger WHERE owner_id=?').get(ownerId);
  assert.ok(erased, 'Account erasure requires preserved deletion evidence');
  // Match the independent shared-copy lifecycle in account-deletion.ts. An
  // approved, explicitly consented contribution survives without its account
  // relationship; a pending contribution and its private source do not.
  for (const row of db.prepare("SELECT * FROM community_assets WHERE contributor_id=? AND status<>'approved'").all(ownerId)) {
    preserveCommunityErasure(db, { asset_id: row.id, storage_id: row.storage_id, requested_at: erased.requested_at, expires_at: erased.requested_at + erasureRetention });
    objects.delete(row.object_key);
  }
  const approved = db.prepare("SELECT * FROM community_assets WHERE contributor_id=? AND status='approved'").all(ownerId);
  for (const row of approved) assert.equal(row.consent_version, 'community-assets-v1', 'Retained contributions require explicit consent evidence');
  if (db.prepare('SELECT 1 FROM account_suspensions WHERE user_id=?').get(ownerId)) {
    for (const row of approved) db.prepare("INSERT INTO moderation_hidden (target_kind,target_id,owner_id,moderator_id,created_at) VALUES ('asset',?,NULL,NULL,?) ON CONFLICT(target_kind,target_id) DO NOTHING").run(row.id, new Date(erased.requested_at).toISOString());
  }
  db.prepare("UPDATE moderation_hidden SET owner_id=NULL WHERE target_kind='asset' AND owner_id=?").run(ownerId);
  db.prepare("DELETE FROM community_assets WHERE contributor_id=? AND status<>'approved'").run(ownerId);
  db.prepare("UPDATE community_assets SET contributor_id=NULL WHERE contributor_id=? AND status='approved'").run(ownerId);
  db.prepare("UPDATE community_asset_reviews SET moderator_id=NULL,note='Reviewer account deleted.' WHERE moderator_id=?").run(ownerId);
  const retainedKeys = new Set(approved.map(row => row.object_key));
  const keys = db.prepare('SELECT object_key FROM assets WHERE owner_id=? UNION SELECT object_key FROM asset_transfers WHERE owner_id=?').all(ownerId, ownerId);
  for (const { object_key } of keys) if (!retainedKeys.has(object_key)) objects.delete(object_key);
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
  const pendingDeletions = current.prepare('SELECT * FROM account_deletion_jobs').all();
  const liveUsers = current.prepare('SELECT * FROM auth_user').all();
  const liveShared = current.prepare('SELECT * FROM community_assets').all();
  const liveSharedById = new Map(liveShared.map(row => [row.id, row]));
  const sharedErasures = [...candidate.prepare('SELECT * FROM community_asset_erasures').all(), ...current.prepare('SELECT * FROM community_asset_erasures').all()];
  const erasedSharedIds = new Set(sharedErasures.map(row => row.asset_id));
  const erasedStorageIds = new Set(sharedErasures.map(row => row.storage_id));
  const currentIds = new Set(liveUsers.map(user => user.id));
  const deletionEvidence = [...candidate.prepare('SELECT * FROM account_erasure_ledger').all(), ...liveLedger, ...pendingDeletions.map(row => ({ owner_id: row.owner_id, requested_at: row.requested_at, expires_at: row.requested_at + erasureRetention }))];
  const erasedIds = new Set(deletionEvidence.map(row => row.owner_id));
  for (const { id } of candidate.prepare('SELECT id FROM auth_user').all()) {
    assert.ok(currentIds.has(id) || erasedIds.has(id), 'Unknown identity state blocks promotion');
  }
  for (const historical of candidate.prepare('SELECT * FROM community_assets').all()) {
    const latest = liveSharedById.get(historical.id);
    assert.ok(latest || erasedSharedIds.has(historical.id) || erasedStorageIds.has(historical.storage_id), 'Unknown shared asset state blocks promotion');
    if (latest) for (const field of ['storage_id', 'object_key', 'content_hash', 'mime', 'size']) assert.equal(latest[field], historical[field], 'Conflicting shared storage identity blocks promotion');
  }
  for (const row of liveShared) {
    assert.equal(row.consent_version, 'community-assets-v1', 'Shared contributions require explicit consent evidence');
    assert.ok(['pending', 'approved', 'rejected', 'withdrawn'].includes(row.status), 'Unknown shared asset status blocks promotion');
    assert.ok(row.contributor_id === null || currentIds.has(row.contributor_id) || erasedIds.has(row.contributor_id), 'Unknown contributor identity blocks promotion');
    assert.equal(row.object_key, 'private/' + row.storage_id, 'Shared copies require their immutable storage key');
  }
  // Stage file changes too: a failed identity, consent or checksum check must
  // not partially delete files while the candidate database rolls back.
  const stagedObjects = new Map(restoredObjects);
  candidate.exec('BEGIN IMMEDIATE');
  try {
    for (const row of deletionEvidence) candidate.prepare('INSERT INTO account_erasure_ledger (owner_id,requested_at,expires_at) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET requested_at=MIN(requested_at,excluded.requested_at),expires_at=MAX(expires_at,excluded.expires_at)').run(row.owner_id, row.requested_at, row.expires_at);
    for (const row of sharedErasures) preserveCommunityErasure(candidate, row);
    // Replace historical shared records with the preserved current catalogue,
    // including approvals made after the content snapshot. Deleting an account
    // against old pending rows could otherwise erase a now-approved copy.
    candidate.exec('DELETE FROM community_asset_reviews; DELETE FROM community_asset_editions; DELETE FROM community_assets');
    for (const { owner_id } of candidate.prepare('SELECT owner_id FROM account_erasure_ledger').all()) eraseRestoredOwner(candidate, owner_id, stagedObjects);
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
      for (const row of current.prepare(`SELECT * FROM ${table}`).all()) {
        if (table === 'reader_blocks' && (erasedIds.has(row.blocker_id) || erasedIds.has(row.blocked_owner_id))) continue;
        if (table === 'account_suspensions' && erasedIds.has(row.user_id)) continue;
        if (table === 'account_suspensions' && erasedIds.has(row.moderator_id)) row.moderator_id = null;
        if (table === 'moderation_hidden') {
          if (erasedIds.has(row.owner_id) && row.target_kind !== 'asset') continue;
          if (erasedIds.has(row.owner_id)) row.owner_id = null;
          if (erasedIds.has(row.moderator_id)) row.moderator_id = null;
        }
        insertRow(candidate, table, row);
      }
    }
    const suspendedIds = new Set(current.prepare('SELECT user_id FROM account_suspensions').all().map(row => row.user_id));
    for (const source of liveShared) {
      const row = { ...source };
      if (row.contributor_id && erasedIds.has(row.contributor_id)) {
        if (row.status !== 'approved') {
          const { requested_at, expires_at } = candidate.prepare('SELECT * FROM account_erasure_ledger WHERE owner_id=?').get(row.contributor_id);
          preserveCommunityErasure(candidate, { asset_id: row.id, storage_id: row.storage_id, requested_at, expires_at });
          continue;
        }
        if (suspendedIds.has(row.contributor_id)) candidate.prepare("INSERT INTO moderation_hidden (target_kind,target_id,owner_id,moderator_id,created_at) VALUES ('asset',?,NULL,NULL,?) ON CONFLICT(target_kind,target_id) DO NOTHING").run(row.id, row.updated_at);
        row.contributor_id = null;
      }
      assert.ok(row.status !== 'pending' || row.contributor_id, 'Pending contributions require a surviving contributor');
      insertRow(candidate, 'community_assets', row);
    }
    const retainedSharedIds = new Set(candidate.prepare('SELECT id FROM community_assets').all().map(row => row.id));
    for (const table of ['community_asset_editions', 'community_asset_reviews']) {
      for (const row of current.prepare(`SELECT * FROM ${table}`).all()) {
        if (!retainedSharedIds.has(row.asset_id)) continue;
        if (table === 'community_asset_reviews' && erasedIds.has(row.moderator_id)) {
          row.moderator_id = null;
          row.note = 'Reviewer account deleted.';
        }
        insertRow(candidate, table, row);
      }
    }
    // Visibility is separate from file retention. Hidden approved copies may
    // remain in private recovery storage, but their current hide decisions stay
    // in force. Erased, withdrawn or rejected bytes never enter this manifest.
    const manifest = [
      ...candidate.prepare(`SELECT a.object_key,a.size,NULL AS content_hash FROM assets a
        WHERE EXISTS (SELECT 1 FROM auth_user u WHERE u.id=a.owner_id)
        AND NOT EXISTS (SELECT 1 FROM account_erasure_ledger e WHERE e.owner_id=a.owner_id)
        AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs j WHERE j.owner_id=a.owner_id)`).all(),
      ...candidate.prepare(`SELECT c.object_key,c.size,c.content_hash FROM community_assets c
        WHERE c.status IN ('pending','approved')
        AND NOT EXISTS (SELECT 1 FROM community_asset_erasures e WHERE e.asset_id=c.id OR e.storage_id=c.storage_id)
        AND (c.status='approved' OR (EXISTS (SELECT 1 FROM auth_user u WHERE u.id=c.contributor_id)
          AND NOT EXISTS (SELECT 1 FROM account_erasure_ledger e WHERE e.owner_id=c.contributor_id)
          AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs j WHERE j.owner_id=c.contributor_id)))`).all(),
    ];
    const eligibleKeys = new Set(manifest.map(row => row.object_key));
    for (const key of stagedObjects.keys()) if (!eligibleKeys.has(key)) stagedObjects.delete(key);
    for (const row of manifest) {
      const bytes = stagedObjects.get(row.object_key);
      assert.ok(bytes, 'Missing restored original blocks promotion');
      assert.equal(bytes.byteLength, row.size, 'Restored original size mismatch blocks promotion');
      if (row.content_hash) assert.equal(bytesDigest(bytes), row.content_hash, 'Shared original checksum mismatch blocks promotion');
    }
    assert.deepEqual(candidate.prepare('PRAGMA foreign_key_check').all(), []);
    candidate.exec('COMMIT');
  } catch (error) { candidate.exec('ROLLBACK'); throw error; }
  restoredObjects.clear();
  for (const [key, bytes] of stagedObjects) restoredObjects.set(key, bytes);
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

test('shared-asset restore honors later withdrawals, approvals, contributor erasure and moderation without reviving revoked bytes', () => {
  const runtime = fileURLToPath(new URL('../.sites-runtime/', import.meta.url));
  mkdirSync(runtime, { recursive: true });
  const scratch = mkdtempSync(resolve(runtime, 'shared-restore-rehearsal-'));
  const current = freshDatabase();
  let candidate;
  const stamp = 1_800_000_000_000, iso = new Date(stamp).toISOString();
  const backupObjects = new Map();
  const sharedIds = ['withdrawn', 'rejected', 'retained', 'promoted', 'pending', 'suspended', 'hidden', 'deleting'];
  const sharedKey = name => 'private/as_shared_' + name;
  const publicSharedIds = db => db.prepare(`SELECT c.id FROM community_assets c WHERE c.status='approved'
    AND NOT EXISTS (SELECT 1 FROM community_asset_erasures e WHERE e.asset_id=c.id)
    AND NOT EXISTS (SELECT 1 FROM moderation_hidden h WHERE h.target_kind='asset' AND h.target_id=c.id)
    AND NOT EXISTS (SELECT 1 FROM account_suspensions s WHERE s.user_id=c.contributor_id)
    ORDER BY c.id`).all().map(row => row.id);
  try {
    for (const id of ['collector', 'contributor', 'suspended', 'deleting']) insertRow(current, 'auth_user', { id, name: id, email: id + '@accounts.invalid', username: id, email_verified: 0, created_at: stamp, updated_at: stamp });
    for (const name of sharedIds) {
      const contributor = ['retained', 'promoted', 'pending'].includes(name) ? 'contributor' : ['suspended', 'deleting'].includes(name) ? name : 'collector';
      const bytes = new TextEncoder().encode('synthetic transparent artwork: ' + name);
      backupObjects.set(sharedKey(name), bytes);
      const kind = name === 'retained' ? 'spine' : 'decor';
      insertRow(current, 'community_assets', {
        id: 'ca_' + name, contributor_id: contributor, kind,
        status: ['rejected', 'promoted', 'pending', 'deleting'].includes(name) ? 'pending' : 'approved',
        storage_id: 'as_shared_' + name, object_key: sharedKey(name), mime: 'image/png', size: bytes.byteLength,
        content_hash: bytesDigest(bytes), edition_key: kind === 'spine' ? 'isbn:9781234567897' : '',
        metadata: JSON.stringify({ title: 'Fixture ' + name, creator: 'Chosen public credit', license: 'community-permission', edition: kind === 'spine' ? { isbn: '9781234567897' } : undefined }),
        consent_version: 'community-assets-v1', review_note: '', created_at: iso, updated_at: iso,
      });
    }
    for (const edition_key of ['isbn:9781234567897', 'edition:OL123M']) insertRow(current, 'community_asset_editions', { asset_id: 'ca_retained', edition_key });
    insertRow(current, 'community_asset_reviews', { id: 'review-retained', asset_id: 'ca_retained', moderator_id: 'contributor', action: 'approve', note: 'Old private reviewer note', created_at: iso });
    const privateSource = new TextEncoder().encode('private source upload, separate from the consented copy');
    backupObjects.set('private/as_source', privateSource);
    insertRow(current, 'assets', { id: 'as_source', owner_id: 'contributor', kind: 'image', object_key: 'private/as_source', filename: 'private-spine.png', mime: 'image/png', size: privateSource.byteLength, created_at: iso });
    const snapshotPath = resolve(scratch, 'synthetic-shared-backup.sqlite');
    current.prepare('VACUUM INTO ?').run(snapshotPath);

    // These decisions occur AFTER the backup. Its public flags and contributor
    // relationships are consequently unsafe until the latest state is applied.
    const later = stamp + 2000, laterIso = new Date(later).toISOString();
    const liveObjects = new Map(backupObjects);
    for (const status of ['withdrawn', 'rejected']) {
      current.prepare('UPDATE community_assets SET status=?,review_note=?,updated_at=? WHERE id=?').run(status, 'Current decision: ' + status, laterIso, 'ca_' + status);
      preserveCommunityErasure(current, { asset_id: 'ca_' + status, storage_id: 'as_shared_' + status, requested_at: later, expires_at: later + erasureRetention });
      liveObjects.delete(sharedKey(status));
    }
    current.prepare("UPDATE community_assets SET status='approved',updated_at=? WHERE id='ca_promoted'").run(laterIso);
    insertRow(current, 'community_asset_reviews', { id: 'review-promoted', asset_id: 'ca_promoted', moderator_id: 'collector', action: 'approve', note: 'Latest approval', created_at: laterIso });
    insertRow(current, 'moderation_hidden', { target_kind: 'asset', target_id: 'ca_hidden', owner_id: null, moderator_id: 'collector', created_at: laterIso });
    insertRow(current, 'account_suspensions', { user_id: 'suspended', reason: 'Fixture moderation decision', created_at: laterIso, moderator_id: 'collector' });
    for (const id of ['contributor', 'suspended']) {
      insertRow(current, 'account_erasure_ledger', { owner_id: id, requested_at: later, expires_at: later + erasureRetention });
      eraseRestoredOwner(current, id, liveObjects);
    }
    // A pending deletion obligation is also authoritative if cleanup has not
    // finished; it must not allow pending copies to be recovered for that user.
    insertRow(current, 'account_deletion_jobs', { id: 'delete-in-progress', owner_id: 'deleting', requested_at: later, updated_at: later, next_attempt_at: later, attempts: 0, lease_until: 0 });
    assert.ok(liveObjects.has(sharedKey('retained')) && liveObjects.has(sharedKey('promoted')));
    assert.ok(!liveObjects.has(sharedKey('pending')) && !liveObjects.has('private/as_source'));
    assert.equal(current.prepare("SELECT owner_id FROM moderation_hidden WHERE target_kind='asset' AND target_id='ca_suspended'").get().owner_id, null, 'Deleting a suspended contributor preserves an independent asset hide');

    const restorePath = resolve(scratch, 'synthetic-shared-restored.sqlite');
    copyFileSync(snapshotPath, restorePath);
    candidate = new DatabaseSync(restorePath);
    fixtureDatabases.add(candidate);
    candidate.exec('PRAGMA foreign_keys=ON');
    const restoredObjects = new Map(backupObjects);
    assert.equal(candidate.prepare("SELECT status FROM community_assets WHERE id='ca_promoted'").get().status, 'pending');
    assert.ok(publicSharedIds(candidate).includes('ca_withdrawn'), 'The raw snapshot would revive a withdrawn image');
    assert.ok(publicSharedIds(candidate).includes('ca_hidden'), 'The raw snapshot predates the moderation decision');

    const latestHidden = current.prepare("SELECT * FROM community_assets WHERE id='ca_hidden'").get();
    current.prepare("DELETE FROM community_assets WHERE id='ca_hidden'").run();
    assert.throws(() => reconcileDisposableRestore(candidate, current, restoredObjects), /Unknown shared asset state blocks promotion/);
    assert.equal(restoredObjects.size, backupObjects.size, 'Missing current asset evidence leaves staged files untouched');
    insertRow(current, 'community_assets', latestHidden);
    const badBytes = restoredObjects.get(sharedKey('retained')).slice();
    badBytes[0] ^= 0xff;
    restoredObjects.set(sharedKey('retained'), badBytes);
    assert.throws(() => reconcileDisposableRestore(candidate, current, restoredObjects), /Shared original checksum mismatch blocks promotion/);
    assert.equal(candidate.prepare("SELECT COUNT(*) AS n FROM auth_user WHERE id='contributor'").get().n, 1, 'Failed verification rolls back database reconciliation');
    assert.equal(candidate.prepare("SELECT status FROM community_assets WHERE id='ca_promoted'").get().status, 'pending');
    assert.ok(restoredObjects.has(sharedKey('withdrawn')), 'Failed verification does not partially mutate the staged file map');
    restoredObjects.set(sharedKey('retained'), backupObjects.get(sharedKey('retained')));

    reconcileDisposableRestore(candidate, current, restoredObjects);
    assert.deepEqual(publicSharedIds(candidate), ['ca_promoted', 'ca_retained']);
    for (const name of ['withdrawn', 'rejected', 'pending', 'deleting']) {
      assert.ok(!restoredObjects.has(sharedKey(name)), name + ' bytes must not be restored');
      assert.equal(candidate.prepare('SELECT storage_id FROM community_asset_erasures WHERE asset_id=?').get('ca_' + name).storage_id, 'as_shared_' + name);
    }
    for (const name of ['pending', 'deleting']) assert.equal(candidate.prepare('SELECT COUNT(*) AS n FROM community_assets WHERE id=?').get('ca_' + name).n, 0);
    for (const status of ['withdrawn', 'rejected']) assert.equal(candidate.prepare('SELECT status FROM community_assets WHERE id=?').get('ca_' + status).status, status, 'Current audit metadata does not imply permission to restore bytes');
    for (const name of ['retained', 'promoted', 'suspended']) {
      const row = candidate.prepare('SELECT * FROM community_assets WHERE id=?').get('ca_' + name);
      assert.equal(row.status, 'approved');
      assert.equal(row.contributor_id, null, 'Recovery must not restore a deleted contributor relationship');
      assert.equal(row.consent_version, 'community-assets-v1');
      assert.equal(JSON.parse(row.metadata).creator, 'Chosen public credit');
      assert.equal(bytesDigest(restoredObjects.get(row.object_key)), row.content_hash);
    }
    assert.deepEqual(candidate.prepare("SELECT edition_key FROM community_asset_editions WHERE asset_id='ca_retained' ORDER BY edition_key").all().map(row => row.edition_key), ['edition:OL123M', 'isbn:9781234567897'], 'Edition aliases remain attached to the independent shared copy');
    const erasedReview = candidate.prepare("SELECT moderator_id,note FROM community_asset_reviews WHERE id='review-retained'").get();
    assert.equal(erasedReview.moderator_id, null);
    assert.equal(erasedReview.note, 'Reviewer account deleted.');
    assert.equal(candidate.prepare("SELECT note FROM community_asset_reviews WHERE id='review-promoted'").get().note, 'Latest approval');
    for (const id of ['contributor', 'suspended', 'deleting']) assert.equal(candidate.prepare('SELECT COUNT(*) AS n FROM auth_user WHERE id=?').get(id).n, 0);
    assert.ok(!restoredObjects.has('private/as_source'), 'Retaining the approved copy does not retain its private source');
    for (const name of ['suspended', 'hidden']) {
      assert.equal(candidate.prepare("SELECT COUNT(*) AS n FROM moderation_hidden WHERE target_kind='asset' AND target_id=?").get('ca_' + name).n, 1);
      assert.ok(restoredObjects.has(sharedKey(name)), 'A private retained copy is distinct from public permission');
      assert.ok(!publicSharedIds(candidate).includes('ca_' + name));
    }
    assert.equal(restoredObjects.size, 4);
    assert.deepEqual(candidate.prepare('PRAGMA foreign_key_check').all(), []);
    const retainedState = () => JSON.stringify({
      assets: candidate.prepare('SELECT * FROM community_assets ORDER BY id').all(),
      erasures: candidate.prepare('SELECT * FROM community_asset_erasures ORDER BY asset_id').all(),
      editions: candidate.prepare('SELECT * FROM community_asset_editions ORDER BY asset_id,edition_key').all(),
      reviews: candidate.prepare('SELECT * FROM community_asset_reviews ORDER BY id').all(),
      hiding: candidate.prepare('SELECT * FROM moderation_hidden ORDER BY target_kind,target_id').all(),
      files: [...restoredObjects].map(([key, bytes]) => [key, bytesDigest(bytes)]).sort(),
    });
    const beforeRepeat = retainedState();
    reconcileDisposableRestore(candidate, current, restoredObjects);
    assert.equal(retainedState(), beforeRepeat, 'Repeated reconciliation preserves decisions, detached identity and exact bytes');
    // Even an accidentally shorter current export cannot reduce an erasure
    // window already preserved in the candidate.
    current.prepare("UPDATE community_asset_erasures SET expires_at=? WHERE asset_id='ca_withdrawn'").run(later + 1000);
    reconcileDisposableRestore(candidate, current, restoredObjects);
    assert.equal(candidate.prepare("SELECT expires_at FROM community_asset_erasures WHERE asset_id='ca_withdrawn'").get().expires_at, later + erasureRetention);
    assert.ok(!restoredObjects.has(sharedKey('withdrawn')));
  } finally { current.close(); candidate?.close(); rmSync(scratch, { recursive: true, force: true }); }
});
