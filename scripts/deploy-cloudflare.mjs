import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
run(['deploy', '--config', generatedConfig, ...(dryRun ? ['--dry-run'] : [])]);
