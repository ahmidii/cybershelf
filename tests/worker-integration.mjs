import '../scripts/sites-env.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegration } from '../lib/server/integration.test.mjs';
import { runReadingRoomIntegration } from '../lib/server/reading-room.integration.mjs';
import { runBookCommunityIntegration } from '../lib/server/book-community.integration.mjs';
import { runAccountLifecycleIntegration } from '../lib/server/account-lifecycle.integration.mjs';
import { runUsernameAccountIntegration } from '../lib/server/username-accounts.integration.mjs';
import { runAssetTransferIntegration } from '../lib/server/asset-transfers.integration.mjs';
import { runAccountDeletionIntegration } from '../lib/server/account-deletion.integration.mjs';
import { runModerationIntegration } from '../lib/server/moderation.integration.mjs';
import { runOriginalBackupIntegration } from '../lib/server/original-backups.integration.mjs';
import { runSharedAssetsIntegration, sharedAssetCatalogFixture } from '../lib/server/shared-assets.integration.mjs';

// Reuse Wrangler's pinned Miniflare without adding a second runtime version.
const root = fileURLToPath(new URL('..', import.meta.url));
const wranglerRequire = createRequire(realpathSync(resolve(root, 'node_modules/wrangler/package.json')));
const { Miniflare, Log, LogLevel, Response: WorkerResponse } = wranglerRequire('miniflare');
const buildDir = resolve(root, 'dist/server');
let config;
try {
  config = JSON.parse(readFileSync(resolve(buildDir, 'wrangler.json'), 'utf8'));
} catch {
  throw new Error('Build cybershelf before this check: pnpm build && pnpm test:worker');
}
assert.equal(config.assets?.binding, 'ASSETS',
  'The built deployment must declare assets.binding="ASSETS" so canonical catalogue images work in production. Set it in wrangler.jsonc and rebuild; the test must not invent a missing binding.');
assert.equal(typeof config.assets?.directory, 'string',
  'The Cloudflare Vite build must generate the deployment asset directory.');
const base = 'https://cybershelf.test';
const accountsOnly = process.argv.includes('--accounts-only');
const operationsOnly = process.argv.includes('--operations-only');
function workerModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? workerModules(path) : /\.m?js$/.test(entry.name) ? [{ type: 'ESModule', path }] : [];
  });
}
const entryModule = resolve(buildDir, config.main);
const modules = workerModules(buildDir).filter(module => module.path !== entryModule);
const baseOptions = {
  name: 'cybershelf-integration',
  // Vinext has dynamic chunk imports; provide the complete emitted module set
  // just as Wrangler's find_additional_modules option does during deployment.
  modules: [{ type: 'ESModule', path: entryModule }, ...modules],
  modulesRoot: buildDir,
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  host: '127.0.0.1',
  port: 0,
  cf: false,
  log: new Log(LogLevel.WARN),
  bindings: { APP_ORIGIN: base, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), MODERATOR_USER_IDS: 'moderator_fixture', MAINTENANCE_ENABLED: 'true' },
  d1Databases: { DB: 'cybershelf-ephemeral-test-db' },
  r2Buckets: { BUCKET: 'cybershelf-ephemeral-test-files' },
  // No d1Persist/r2Persist, credentials, resource IDs, or remote bindings.
  assets: {
    directory: resolve(buildDir, config.assets.directory),
    binding: config.assets.binding,
    routerConfig: { has_user_worker: true },
  },
  outboundService: () => new WorkerResponse('External network access is disabled in this test.', { status: 502 }),
};
const fixture = new Miniflare(baseOptions);
let mailFixture;
let backupFixture;

const mailbox = {
  messages: [],
  waiting: new Set(),
  fail: false,
  receive(message) {
    this.messages.push(message);
    for (const waiting of this.waiting) if (waiting.predicate(message)) {
      this.waiting.delete(waiting);
      clearTimeout(waiting.timeout);
      waiting.resolve(message);
    }
  },
  waitFor(predicate) {
    const message = this.messages.find(predicate);
    if (message) return Promise.resolve(message);
    return new Promise((resolve, reject) => {
      const waiting = { predicate, resolve, timeout: setTimeout(() => {
        this.waiting.delete(waiting);
        reject(new Error('The local account email was not received. No external email was sent.'));
      }, 5000) };
      this.waiting.add(waiting);
    });
  },
};

try {
  const database = await fixture.getD1Database('DB');
  const journal = JSON.parse(readFileSync(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'));
  for (const migration of journal.entries) {
    const statements = readFileSync(resolve(root, 'drizzle', migration.tag + '.sql'), 'utf8')
      .split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean);
    await database.batch(statements.map(statement => database.prepare(statement)));
  }
  console.log(`Applied ${journal.entries.length} migrations to ephemeral D1.`);
  const requestFetch = async (input, init) => {
    // Node and Miniflare ship distinct FormData classes. Encode the wire request
    // with Node first so multipart boundaries match browser HTTP requests.
    const request = new Request(input, init);
    return fixture.dispatchFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ...(request.body ? { body: new Uint8Array(await request.arrayBuffer()) } : {}),
    });
  };
  if (!accountsOnly && !operationsOnly) {
  const home = await requestFetch(base + '/');
  assert.equal(home.status, 200, 'Guest home renders in workerd');
  assert.equal(home.headers.get('Referrer-Policy'), 'no-referrer', 'External artwork does not receive the reading page URL');
  assert.equal(home.headers.get('X-Frame-Options'), 'DENY', 'Library and sharing controls cannot be framed by another site');
  assert.match(home.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(await home.text(), /cybershelf/i);
  const signIn = await requestFetch(base + '/signin');
  assert.equal(signIn.status, 200, 'Standalone sign-in page renders in workerd');
  assert.match(await signIn.text(), /email/i);
  const basicCapabilities = await requestFetch(base + '/api/health');
  assert.deepEqual(await basicCapabilities.json(), { accounts: true, email: false }, 'Basic accounts work without an email provider');
  console.log('✓ Guest home and sign-in render from the production Worker bundle.');
  const catalog = await requestFetch(base + '/books');
  assert.equal(catalog.status, 200, 'Public catalog renders in workerd');
  assert.match(await catalog.text(), /aria-label="Search the book catalog"/);
  const missingBook = await requestFetch(base + '/books/cs_' + '0'.repeat(64));
  assert.equal(missingBook.status, 404, 'An unknown community work returns a real page 404');
  console.log('✓ Public catalog and missing-book status render from the production Worker bundle.');
  await runIntegration({ base, fetch: requestFetch, report: message => console.log('✓ ' + message) });
  await runReadingRoomIntegration({ base, fetch: requestFetch, database, report: message => console.log('✓ ' + message) });
  await runBookCommunityIntegration({ base, fetch: requestFetch, database, report: message => console.log('✓ ' + message) });
  const hashes = await database.prepare('SELECT password FROM auth_account').all();
  assert.ok(hashes.results.length >= 2);
  for (const row of hashes.results) {
    assert.match(row.password, /^cs_scrypt_v1\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/, 'New credential accounts contain the versioned, salted scrypt hash');
  }
  const counters = await database.prepare('SELECT COUNT(*) AS total FROM auth_rate_limit').first();
  assert.ok(counters.total > 0, 'Rate-limit counters are persisted in D1');
  console.log('✓ D1 stores salted password hashes and shared rate-limit counters.');
  }

  if (!operationsOnly) {
  mailFixture = new Miniflare({
    ...baseOptions,
    name: 'cybershelf-account-email-integration',
    bindings: { ...baseOptions.bindings, RESEND_API_KEY: 're_local_test_key_never_sent', AUTH_EMAIL_FROM: 'cybershelf <accounts@cybershelf.test>' },
    outboundService: async request => {
      const catalogue = sharedAssetCatalogFixture(request.url);
      if (catalogue) return new WorkerResponse(JSON.stringify(catalogue), { headers: { 'Content-Type': 'application/json' } });
      if (request.url !== 'https://api.resend.com/emails') return new WorkerResponse('External network access is disabled in this test.', { status: 502 });
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('Authorization'), 'Bearer re_local_test_key_never_sent');
      const message = await request.json();
      mailbox.receive(message);
      return new WorkerResponse(JSON.stringify(mailbox.fail ? { error: 'simulated local provider failure' } : { id: crypto.randomUUID() }), {
        status: mailbox.fail ? 503 : 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const mailDatabase = await mailFixture.getD1Database('DB');
  for (const migration of journal.entries) {
    const statements = readFileSync(resolve(root, 'drizzle', migration.tag + '.sql'), 'utf8')
      .split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean);
    await mailDatabase.batch(statements.map(statement => mailDatabase.prepare(statement)));
  }
  const mailFetch = async (input, init) => {
    const request = new Request(input, init);
    return mailFixture.dispatchFetch(request.url, {
      method: request.method,
      redirect: 'manual',
      headers: Object.fromEntries(request.headers),
      ...(request.body ? { body: new Uint8Array(await request.arrayBuffer()) } : {}),
    });
  };
  await runAccountLifecycleIntegration({ base, fetch: mailFetch, database: mailDatabase, mailbox, report: message => console.log('✓ ' + message) });
  mailbox.fail = false;
  await runUsernameAccountIntegration({ base, fetch: mailFetch, database: mailDatabase, mailbox, report: message => console.log('✓ ' + message) });
  const mailBucket = await mailFixture.getR2Bucket('BUCKET');
  await runAssetTransferIntegration({ base, fetch: mailFetch, database: mailDatabase, bucket: mailBucket, report: message => console.log('✓ ' + message) });
  await runModerationIntegration({ base, fetch: mailFetch, database: mailDatabase, report: message => console.log('✓ ' + message) });
  await runSharedAssetsIntegration({ base, fetch: mailFetch, database: mailDatabase, bucket: mailBucket, report: message => console.log('✓ ' + message) });
  await runAccountDeletionIntegration({ base, fetch: mailFetch, database: mailDatabase, bucket: mailBucket, authBindings: baseOptions.bindings, report: message => console.log('✓ ' + message) });
  }

  // Recovery scans require isolated, complete originals. Other suites deliberately
  // seed metadata without bytes and must never make a backup silently skip loss.
  backupFixture = new Miniflare({ ...baseOptions, name: 'cybershelf-original-backup-integration',
    r2Buckets: { BUCKET: 'cybershelf-backup-fixture-originals', BACKUP_BUCKET: 'cybershelf-backup-fixture-copies' } });
  const backupDatabase = await backupFixture.getD1Database('DB');
  for (const migration of journal.entries) {
    const statements = readFileSync(resolve(root, 'drizzle', migration.tag + '.sql'), 'utf8')
      .split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean);
    await backupDatabase.batch(statements.map(statement => backupDatabase.prepare(statement)));
  }
  const originalBucket = await backupFixture.getR2Bucket('BUCKET');
  const backupBucket = await backupFixture.getR2Bucket('BACKUP_BUCKET');
  const operationsHealth = async () => {
    const response = await backupFixture.dispatchFetch(base + '/api/health?check=operations');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
  };
  let operations = (await operationsHealth()).operations;
  assert.deepEqual(operations, { moderationConfigured: false, maintenanceConfigured: true,
    maintenanceStarted: false, maintenanceRecent: false, cleanupHealthy: true, backupConfigured: true, backupRecent: false });
  await backupDatabase.prepare('INSERT INTO maintenance_state (key,value,updated_at) VALUES (?,?,?)')
    .bind('housekeeping.v1', JSON.stringify({lastFailureAt:Date.now(),leaseUntil:0}), Date.now()).run();
  const firstFailure = (await operationsHealth()).operations;
  assert.equal(firstFailure.maintenanceStarted, true, 'An attempted first run is distinguishable from a missing schedule');
  assert.equal(firstFailure.maintenanceRecent, false);
  assert.equal(firstFailure.cleanupHealthy, false, 'A failure before any successful run cannot pass cleanup health');
  await backupDatabase.prepare("DELETE FROM maintenance_state WHERE key='housekeeping.v1'").run();
  const now = Date.now(), syntheticKey = 'private/as_scheduled_cleanup_fixture';
  await backupDatabase.prepare('INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind('moderator_fixture', 'Synthetic moderator', 'moderator@example.invalid', 1, now, now).run();
  await originalBucket.put(syntheticKey, 'synthetic obsolete bytes');
  await backupDatabase.batch([
    backupDatabase.prepare('INSERT INTO account_deletion_jobs (id,owner_id,requested_at,updated_at,next_attempt_at,attempts,lease_until) VALUES (?,?,?,?,?,0,0)')
      .bind('scheduled_job_fixture', 'deleted_fixture_owner', now - 1000, now - 1000, now - 1000),
    backupDatabase.prepare("INSERT INTO asset_transfers (id,owner_id,object_key,size,state,writer_done,created_at,updated_at,expires_at,next_attempt_at,attempts,lease_until) VALUES (?,?,?,24,'cleanup',1,?,?,?,?,0,0)")
      .bind('as_scheduled_cleanup_fixture', 'deleted_fixture_owner', syntheticKey, now - 1000, now - 1000, now - 1000, now - 1000),
  ]);
  const scheduledWorker = await backupFixture.getWorker();
  await scheduledWorker.scheduled({ cron: '*/5 * * * *', scheduledTime: now });
  assert.equal(await originalBucket.head(syntheticKey), null, 'A real scheduled event drains durable file cleanup without a browser request');
  assert.equal((await backupDatabase.prepare('SELECT COUNT(*) AS n FROM account_deletion_jobs').first()).n, 0);
  const streamedKey = 'private/as_scheduled_backup_fixture';
  const streamedBytes = new TextEncoder().encode('%PDF-1.7\nSynthetic native Worker streaming test.');
  await originalBucket.put(streamedKey, streamedBytes, { httpMetadata: { contentType: 'application/pdf' } });
  await backupDatabase.prepare('INSERT INTO assets (id,owner_id,kind,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind('as_scheduled_backup_fixture', 'moderator_fixture', 'book', streamedKey, 'synthetic.pdf', 'application/pdf', streamedBytes.length, new Date(now - 1000).toISOString()).run();
  await scheduledWorker.scheduled({ cron: '2-59/5 * * * *', scheduledTime: now });
  const streamedCopy = await backupBucket.get(streamedKey);
  assert.ok(streamedCopy, 'The actual Worker scheduled handler streams an original to the separate R2 binding');
  assert.deepEqual(new Uint8Array(await streamedCopy.arrayBuffer()), streamedBytes);
  operations = (await operationsHealth()).operations;
  assert.deepEqual(operations, { moderationConfigured: true, maintenanceConfigured: true,
    maintenanceStarted: true, maintenanceRecent: true, cleanupHealthy: true, backupConfigured: true, backupRecent: true });
  assert.equal(JSON.stringify(operations).includes('moderator_fixture'), false);
  await backupDatabase.prepare("INSERT INTO asset_transfers (id,owner_id,object_key,size,state,writer_done,created_at,updated_at,expires_at,next_attempt_at,attempts,lease_until) VALUES (?,?,?,24,'cleanup',1,?,?,?,?,1,0)")
    .bind('as_failed_removal_fixture', 'moderator_fixture', 'private/as_failed_removal_fixture', now, now, now, now + 60_000).run();
  assert.equal((await operationsHealth()).operations.cleanupHealthy, false, 'A failed file removal cannot pass health just because no account deletion is pending');
  await backupDatabase.prepare('DELETE FROM asset_transfers WHERE id=?').bind('as_failed_removal_fixture').run();
  await backupDatabase.prepare("UPDATE maintenance_state SET value=json_set(value,'$.lastCompletedAt',?) WHERE key='housekeeping.v1'")
    .bind(now - 16 * 60_000).run();
  assert.equal((await operationsHealth()).operations.maintenanceRecent, false, 'A stale completed maintenance run fails the monitor');
  await backupDatabase.prepare('DELETE FROM assets').run();
  await originalBucket.delete(streamedKey);
  await backupBucket.delete(streamedKey);
  await backupDatabase.prepare('DELETE FROM maintenance_state').run();
  console.log('✓ Real scheduled cleanup and original-backup events persist health evidence; missing moderators and stale runs fail readiness without exposing identities.');
  await runOriginalBackupIntegration({ database: backupDatabase, bucket: originalBucket, backupBucket, report: message => console.log('✓ ' + message) });
  console.log('Worker integration checks passed; no external resources were used.');
} finally {
  for (const waiting of mailbox.waiting) clearTimeout(waiting.timeout);
  if (mailFixture) await mailFixture.dispose();
  if (backupFixture) await backupFixture.dispose();
  await fixture.dispose();
}
