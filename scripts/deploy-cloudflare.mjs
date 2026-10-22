import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureAuthSecret } from './ensure-auth-secret.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const generatedConfig = 'dist/server/wrangler.json';
const options = process.argv.slice(2).filter((value) => value !== '--');
if (options.some((value) => value !== '--dry-run')) throw new Error('Usage: pnpm run deploy [--dry-run]');
const dryRun = options.includes('--dry-run');

if (!existsSync(new URL('../dist/server/index.js', import.meta.url))) {
  throw new Error('Build the application first: pnpm run build');
}
const config = JSON.parse(readFileSync(new URL(`../${generatedConfig}`, import.meta.url), 'utf8'));
const database = config.d1_databases?.find((binding) => binding.binding === 'DB');
const bucket = config.r2_buckets?.find((binding) => binding.binding === 'BUCKET');
if (!database?.database_id || database.database_id === '00000000-0000-4000-8000-000000000000'
  || !bucket?.bucket_name || bucket.bucket_name === 'site-creator-r2') {
  throw new Error('The build needs real DB and BUCKET bindings. Check wrangler.jsonc and rebuild.');
}
if (!config.vars?.APP_ORIGIN?.startsWith('https://')) {
  throw new Error('Set APP_ORIGIN to your HTTPS origin in wrangler.jsonc and rebuild.');
}

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// A dry run validates the built upload without logging in or touching D1.
if (!dryRun) {
  // Wrangler records applied migrations; a retry applies only pending files.
  // Stop immediately on migration failure, keeping the previous Worker live.
  run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.jsonc']);
}
// Keep optional runtime configuration (for example the verified mail sender)
// across builds. Explicit source vars such as APP_ORIGIN still take precedence.
run(['deploy', '--config', generatedConfig, '--keep-vars', ...(dryRun ? ['--dry-run'] : [])]);

if (!dryRun) {
  // Deploy first so this also works for a fresh Worker. A missing key is then
  // installed as an encrypted Worker secret; a configured key is never replaced.
  // secret put deploys its new binding immediately. Only stdin carries the key.
  const result = ensureAuthSecret({
    buildSecret: process.env.BETTER_AUTH_SECRET,
    configPath: generatedConfig,
    accountsAvailable: await accountsReady(),
    runPrivate(args, input) {
      return spawnSync(process.execPath, [wrangler, ...args], {
        cwd: root,
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_WRITE_LOGS: 'false' },
      });
    },
  });
  console.log(result === 'created'
    ? 'Account authentication is configured. The new secret is stored only in Cloudflare.'
    : 'Existing account authentication setting preserved.');
  if (!await accountsReady(result === 'created')) {
    throw new Error('The Worker was published, but account configuration is still unavailable. Check runtime BETTER_AUTH_SECRET, DB, and APP_ORIGIN; an existing secret was not replaced.');
  }
  console.log('Live account configuration verified on the application origin.');
}

async function accountsReady(waitForAvailable = false) {
  // A read-only, credential-free check also protects working legacy runtime
  // keys from replacement. No keys, emails, cookies, or account rows are read.
  const statusURL = new URL('/api/health', config.vars.APP_ORIGIN);
  let observedStatus = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(statusURL, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const data = await response.json();
        if (typeof data?.accounts === 'boolean' && typeof data?.email === 'boolean') {
          observedStatus = true;
          if (data.accounts || !waitForAvailable) return data.accounts;
        }
      }
    } catch { /* Only a generic deployment diagnostic may leave this function. */ }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (observedStatus) return false;
  throw new Error('The Worker was published, but its public account status could not be checked. No authentication key was replaced. Confirm APP_ORIGIN and the domain route, then retry deployment.');
}
