import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './sites-env.mjs';

const envFile = fileURLToPath(new URL('../.dev.vars', import.meta.url));
if (!existsSync(envFile)) throw new Error('Run pnpm run setup:local before starting a local preview.');
const cli = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
process.argv = [
  process.execPath, fileURLToPath(cli), 'dev',
  '--config', 'dist/server/wrangler.json',
  '--env-file', envFile,
  '--local', '--persist-to', '.wrangler/state',
  '--ip', '127.0.0.1', '--inspector-port', '0',
  ...process.argv.slice(2).filter(value => value !== '--'),
];
await import(cli.href);
