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
for (const source of ['lib/auth-contract.ts', 'db/schema.ts', 'lib/server/auth-email.ts', 'lib/server/auth.ts']) {
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
const { authEmailConfiguration, accountEmailURL, sendAuthEmail } = await import(pathToFileURL(resolve(dir, 'lib/server/auth-email.mjs')));

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

const mailBindings = {
  ...bindings,
  RESEND_API_KEY: 're_local_test_key_not_a_real_credential',
  AUTH_EMAIL_FROM: 'cybershelf <accounts@cybershelf.io>',
};
const resetURL = 'https://cybershelf.io/api/auth/reset-password/abcdefghijklmnopqrstuvwxyz';
const verifyURL = 'https://cybershelf.io/api/auth/verify-email?token=header.payload.signature';

test('email capabilities fail closed for incomplete settings without disabling password accounts', () => {
  for (const patch of [
    { RESEND_API_KEY: undefined }, { RESEND_API_KEY: 'short' }, { RESEND_API_KEY: 're_key\r\nheader' },
    { AUTH_EMAIL_FROM: undefined }, { AUTH_EMAIL_FROM: 'not-an-address' },
    { AUTH_EMAIL_FROM: 'cybershelf <accounts@cybershelf.io>\r\nBcc: someone@example.com' },
    { AUTH_EMAIL_FROM: 'accounts@cybershelf.io, other@example.com' },
  ]) {
    const options = { ...mailBindings, ...patch };
    assert.equal(authEmailConfiguration(options), null);
    const auth = createAuth(options);
    assert.equal(auth.options.emailAndPassword.enabled, true);
    assert.equal(auth.options.emailAndPassword.autoSignIn, true);
    assert.equal(auth.options.emailAndPassword.requireEmailVerification, false);
    assert.equal(auth.options.emailAndPassword.sendResetPassword, undefined);
  }
  assert.equal(authEmailConfiguration(mailBindings).from, mailBindings.AUTH_EMAIL_FROM);
  assert.equal(authEmailConfiguration({ ...mailBindings, AUTH_EMAIL_FROM: 'accounts@cybershelf.io' }).from, 'accounts@cybershelf.io');
});

test('account email links pin callbacks to dedicated screens and reject forged hosts or paths', () => {
  const reset = new URL(accountEmailURL('password-reset', resetURL + '?callbackURL=https://elsewhere.example/steal&unexpected=yes', bindings.APP_ORIGIN));
  assert.equal(reset.searchParams.get('callbackURL'), 'https://cybershelf.io/reset-password');
  assert.equal(reset.searchParams.has('unexpected'), false);
  const verification = new URL(accountEmailURL('verify-email', verifyURL + '&callbackURL=/api/auth/sign-out', bindings.APP_ORIGIN));
  assert.equal(verification.searchParams.get('callbackURL'), 'https://cybershelf.io/account?verified=1');
  assert.equal(verification.searchParams.get('token'), 'header.payload.signature');
  for (const candidate of [
    resetURL.replace('cybershelf.io', 'attacker.example'),
    resetURL.replace('/reset-password/', '/sign-in/'),
    resetURL + '#fragment',
    'https://user:password@cybershelf.io/api/auth/reset-password/abcdefghijklmnopqrstuvwxyz',
    'https://cybershelf.io/api/auth/reset-password/short',
  ]) assert.throws(() => accountEmailURL('password-reset', candidate, bindings.APP_ORIGIN));
  assert.throws(() => accountEmailURL('verify-email', 'https://cybershelf.io/api/auth/verify-email?token=%3Cscript%3E', bindings.APP_ORIGIN));
});

test('account email transport uses a fixed HTTPS provider, a single recipient, bounded request, and safe templates', async () => {
  let call;
  const send = async (url, init) => {
    call = { url, init };
    return Response.json({ id: 'local-accepted-email' });
  };
  await sendAuthEmail(authEmailConfiguration(mailBindings), {
    purpose: 'password-reset', to: 'reader@example.com', origin: bindings.APP_ORIGIN,
    url: resetURL + '?callbackURL=https://attacker.example/',
  }, send);
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'manual');
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.equal(call.init.headers.Authorization, `Bearer ${mailBindings.RESEND_API_KEY}`);
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.to, ['reader@example.com']);
  assert.equal(body.from, mailBindings.AUTH_EMAIL_FROM);
  assert.match(body.subject, /Reset/);
  assert.match(body.text, /expires in one hour/);
  assert.match(body.text, /cybershelf\.io%2Freset-password/);
  assert.doesNotMatch(body.html + body.text, /attacker\.example/);
  assert.doesNotMatch(call.init.body, /re_local_test_key/);
  await assert.rejects(() => sendAuthEmail(authEmailConfiguration(mailBindings), {
    purpose: 'password-reset', to: 'reader@example.com\nBcc: other@example.com', origin: bindings.APP_ORIGIN, url: resetURL,
  }, () => { throw new Error('Invalid recipients must never reach the provider.'); }), /Invalid account email recipient/);
});

test('provider failures never expose provider payloads to the account flow', async () => {
  const email = { purpose: 'verify-email', to: 'reader@example.com', origin: bindings.APP_ORIGIN, url: verifyURL };
  await assert.rejects(() => sendAuthEmail(authEmailConfiguration(mailBindings), email, async () =>
    new Response('recipient-private-detail secret-token', { status: 403 })), error => {
      assert.equal(error.message, 'Account email delivery was not accepted.');
      return true;
    });
  await assert.rejects(() => sendAuthEmail(authEmailConfiguration(mailBindings), email, async () => Response.json({})), /delivery was not accepted/);
  await assert.rejects(() => sendAuthEmail(authEmailConfiguration(mailBindings), email, async (_url, init) => {
    assert.equal(init.redirect, 'manual', 'Credentials must not follow redirects to another provider host.');
    return new Response(null, { status: 302, headers: { Location: 'https://attacker.example/collect' } });
  }), /delivery was not accepted/);
});

test('account mail callbacks register background work without delaying a generic response', async t => {
  let releaseDelivery;
  const delivery = new Promise(resolve => { releaseDelivery = resolve; });
  const pending = [];
  t.mock.method(globalThis, 'fetch', async () => { await delivery; return Response.json({ id: 'accepted-local-test' }); });
  const auth = createAuth(mailBindings, task => pending.push(task));
  await auth.options.emailAndPassword.sendResetPassword({ user: { email: 'reader@example.com' }, url: resetURL });
  assert.equal(pending.length, 1, 'The runtime owns the delivery promise before the callback finishes.');
  assert.equal(auth.options.emailAndPassword.revokeSessionsOnPasswordReset, true);
  assert.equal(auth.options.emailVerification.autoSignInAfterVerification, false);
  releaseDelivery();
  await Promise.all(pending);
});

test('mail dispatch errors become a fixed operational log rather than an address-dependent response', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private recipient and token'); });
  const log = t.mock.method(console, 'error', () => {});
  const auth = createAuth(mailBindings);
  await auth.options.emailAndPassword.sendResetPassword({ user: { email: 'reader@example.com' }, url: resetURL });
  await auth.options.emailVerification.sendVerificationEmail({ user: { email: 'reader@example.com' }, url: verifyURL });
  assert.equal(log.mock.calls.length, 2);
  for (const call of log.mock.calls) assert.deepEqual(call.arguments, ['cybershelf account email delivery failed']);
});

