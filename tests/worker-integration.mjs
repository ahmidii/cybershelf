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
const base = 'https://cybershelf.test';
const accountsOnly = process.argv.includes('--accounts-only');
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
  bindings: { APP_ORIGIN: base, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') },
  d1Databases: { DB: 'cybershelf-ephemeral-test-db' },
  r2Buckets: { BUCKET: 'cybershelf-ephemeral-test-files' },
  // No d1Persist/r2Persist, credentials, resource IDs, or remote bindings.
  assets: {
    directory: resolve(buildDir, config.assets.directory),
    binding: 'ASSETS',
    routerConfig: { has_user_worker: true },
  },
  outboundService: () => new WorkerResponse('External network access is disabled in this test.', { status: 502 }),
};
const fixture = new Miniflare(baseOptions);
let mailFixture;

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
  if (!accountsOnly) {
  const home = await requestFetch(base + '/');
  assert.equal(home.status, 200, 'Guest home renders in workerd');
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
    assert.match(row.password, /^[a-f0-9]{32}:[a-f0-9]{128}$/, 'Credential accounts contain salted scrypt hashes');
  }
  const counters = await database.prepare('SELECT COUNT(*) AS total FROM auth_rate_limit').first();
  assert.ok(counters.total > 0, 'Rate-limit counters are persisted in D1');
  console.log('✓ D1 stores salted password hashes and shared rate-limit counters.');
  }

  mailFixture = new Miniflare({
    ...baseOptions,
    name: 'cybershelf-account-email-integration',
    bindings: { ...baseOptions.bindings, RESEND_API_KEY: 're_local_test_key_never_sent', AUTH_EMAIL_FROM: 'cybershelf <accounts@cybershelf.test>' },
    outboundService: async request => {
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
  console.log('Worker integration checks passed; no external resources were used.');
} finally {
  for (const waiting of mailbox.waiting) clearTimeout(waiting.timeout);
  if (mailFixture) await mailFixture.dispose();
  await fixture.dispose();
}
