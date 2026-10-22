import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const destination = new URL('../.dev.vars', import.meta.url);
if (existsSync(destination)) {
  console.log('.dev.vars already exists; keeping your local settings.');
} else {
  writeFileSync(destination, [
    '# Local development only. This file is ignored by git.',
    'APP_ORIGIN="http://localhost:5173"',
    `BETTER_AUTH_SECRET="${randomBytes(48).toString('base64url')}"`,
    '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  console.log('Created local sign-in settings for http://localhost:5173.');
  console.log('Next: pnpm run db:migrate:local, then pnpm run dev.');
}
