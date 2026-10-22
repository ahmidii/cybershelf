import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Use the real Better Auth package and production modules. D1 intentionally
// throws if touched: unsigned or missing session cookies must not query it.
mkdirSync('.sites-runtime', { recursive: true });
const dir = mkdtempSync(resolve('.sites-runtime/auth-test-'));
for (const source of ['lib/auth-contract.ts', 'db/schema.ts', 'lib/server/auth.ts']) {
  const output = resolve(dir, source.replace(/\.ts$/, '.mjs'));
  mkdirSync(dirname(output), { recursive: true });
  const code = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, specifier) => `from ${quote}${specifier}.mjs${quote}`);
  writeFileSync(output, code);
}
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const { safeRelativeReturnPath, signInPath } = await import(pathToFileURL(resolve(dir, 'lib/auth-contract.mjs')));
const { createAuth, authConfiguration, AuthConfigurationError } = await import(pathToFileURL(resolve(dir, 'lib/server/auth.mjs')));

const bindings = {
  DB: { prepare() { throw new Error('Unauthenticated requests must not query the database.'); } },
  APP_ORIGIN: 'https://cybershelf.io',
  BETTER_AUTH_SECRET: 'local-test-secret-that-is-not-a-production-secret-42',
};

test('authentication configuration fails closed without an explicit secret, database, and trusted origin', () => {
  for (const patch of [
    { DB: undefined }, { BETTER_AUTH_SECRET: undefined }, { BETTER_AUTH_SECRET: 'short' },
    { APP_ORIGIN: undefined }, { APP_ORIGIN: 'http://cybershelf.io' },
    { APP_ORIGIN: 'https://reader:password@cybershelf.io' }, { APP_ORIGIN: 'https://cybershelf.io/api' },
    { APP_ORIGIN: 'https://cybershelf.io?redirect=elsewhere' }, { APP_ORIGIN: 'https://cybershelf.io/#fragment' },
  ]) assert.throws(() => authConfiguration({ ...bindings, ...patch }), AuthConfigurationError);
  assert.equal(authConfiguration(bindings).secureCookies, true);
  assert.equal(authConfiguration({ ...bindings, APP_ORIGIN: 'http://127.0.0.1:5173' }).secureCookies, false);
});

test('sign-in return paths stay on cybershelf and cannot loop through authentication endpoints', () => {
  const path = '/s/shared-shelf?view=books#shelf';
  assert.equal(safeRelativeReturnPath(path), path);
  assert.equal(signInPath(path), '/signin?return_to=%2Fs%2Fshared-shelf%3Fview%3Dbooks%23shelf');
  for (const value of [
    undefined, 'https://other.example', '//other.example', '/\\other.example', '/\n/other.example',
    '/signin', '/signin/', '/%73ignin', '/api/auth/sign-out', '/api%2fauth/sign-in/email', '/%FF',
    '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback',
  ]) assert.equal(safeRelativeReturnPath(value), '/');
});

test('caller-supplied identity headers and unsigned session cookies never authenticate', async () => {
  const auth = createAuth(bindings);
  const spoofed = {
    'oai-authenticated-user-id': 'another-readers-account',
    'oai-authenticated-user-email': 'reader@example.invalid',
    'x-forwarded-host': 'attacker.example',
    'x-forwarded-proto': 'https',
  };
  for (const cookie of ['', 'cybershelf.session_token=forged', '__Secure-cybershelf.session_token=forged.signature']) {
    const result = await auth.api.getSession({ headers: new Headers({ ...spoofed, cookie }) });
    assert.equal(result, null);
  }
});

