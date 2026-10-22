import '../scripts/sites-env.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegration } from '../lib/server/integration.test.mjs';

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
function workerModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? workerModules(path) : /\.m?js$/.test(entry.name) ? [{ type: 'ESModule', path }] : [];
  });
}
const entryModule = resolve(buildDir, config.main);
const modules = workerModules(buildDir).filter(module => module.path !== entryModule);
const fixture = new Miniflare({
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
});

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
  const home = await requestFetch(base + '/');
  assert.equal(home.status, 200, 'Guest home renders in workerd');
  assert.match(await home.text(), /cybershelf/i);
  const signIn = await requestFetch(base + '/signin');
  assert.equal(signIn.status, 200, 'Standalone sign-in page renders in workerd');
  assert.match(await signIn.text(), /email/i);
  console.log('✓ Guest home and sign-in render from the production Worker bundle.');
  await runIntegration({ base, fetch: requestFetch, report: message => console.log('✓ ' + message) });
  const hashes = await database.prepare('SELECT password FROM auth_account').all();
  assert.ok(hashes.results.length >= 2);
  for (const row of hashes.results) {
    assert.match(row.password, /^[a-f0-9]{32}:[a-f0-9]{128}$/, 'Credential accounts contain salted scrypt hashes');
  }
  const counters = await database.prepare('SELECT COUNT(*) AS total FROM auth_rate_limit').first();
  assert.ok(counters.total > 0, 'Rate-limit counters are persisted in D1');
  console.log('✓ D1 stores salted password hashes and shared rate-limit counters.');
  console.log('Worker integration checks passed; no external resources were used.');
} finally {
  await fixture.dispose();
}
