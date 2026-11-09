import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the real components with React. Only CSS imports are replaced; account
// conditions, password-manager attributes, and key visibility remain unchanged.
const root = fileURLToPath(new URL('..', import.meta.url));
const modules = new Map();
function componentModule(relative) {
  const path = resolve(root, relative);
  if (modules.has(path)) return modules.get(path);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: path,
  }).outputText
    .replace(/import styles from ['"][^'"]+\.module\.css['"];?/g, 'const styles = {};')
    .replace(/from (['"])([^'"]+)\1/g, (_, _quote, specifier) => {
      if (specifier.startsWith('@/') || specifier.startsWith('.')) {
        const target = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(path), specifier);
        const extension = target.includes('/components/') || target.includes('/app/') ? '.tsx' : '.ts';
        return 'from ' + JSON.stringify(componentModule(target + extension));
      }
      return 'from ' + JSON.stringify(import.meta.resolve(specifier));
    });
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  modules.set(path, url);
  return url;
}

const { default: SignIn } = await import(componentModule('components/SignIn.tsx'));
const { default: AccountSettings } = await import(componentModule('components/AccountSettings.tsx'));
const { default: AccountRecovery } = await import(componentModule('components/AccountRecovery.tsx'));
const { default: RecoveryKeyPanel } = await import(componentModule('components/RecoveryKeyPanel.tsx'));
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const account = { userId: 'test-account', displayName: 'book_wanderer', username: 'book_wanderer', email: null, emailVerified: false };
const input = (html, id) => html.match(new RegExp('<input\\b[^>]*\\bid="' + id + '"[^>]*>'))?.[0] ?? '';

test('username accounts have no email prompt, verification action, or placeholder address in account settings', () => {
  const html = render(AccountSettings, { user: account, emailAvailable: true });
  assert.match(html, /No email attached/);
  assert.match(html, />book_wanderer</);
  assert.match(html, /Generate new recovery key/);
  assert.equal(html.includes('Send verification link'), false);
  assert.equal(html.includes('claim-username'), false);
  assert.equal(html.includes('accounts.cybershelf.invalid'), false);
  assert.match(html, /href="\/privacy"/);
});

test('existing email accounts keep verification and get a password-protected first-username form', () => {
  const html = render(AccountSettings, { user: { ...account, username: null, email: 'reader@example.test' }, emailAvailable: true });
  assert.match(html, /reader@example.test/);
  assert.match(html, /Send verification link/);
  assert.match(input(html, 'claim-username'), /autoComplete="username"/);
  assert.match(input(html, 'username-password'), /autoComplete="current-password"/);
  assert.match(html, /Choose a username above first/);
  assert.equal(html.includes('Generate new recovery key'), false);
});

test('legacy sign-in and current-password fields do not impose the new-password minimum', () => {
  const login = render(SignIn, { returnTo: '/', available: true, initialIdentifier: 'reader@example.test', reauthenticate: true });
  assert.match(login, /Username or email/);
  assert.match(input(login, 'auth-identifier'), /value="reader@example.test"/);
  assert.equal(input(login, 'auth-password').includes('minLength'), false);
  const settings = render(AccountSettings, { user: account, emailAvailable: false });
  assert.equal(input(settings, 'current-password').includes('minLength'), false);
  assert.equal(input(settings, 'key-password').includes('minLength'), false);
  assert.match(input(settings, 'new-password'), /minLength="15"/);
  assert.match(input(settings, 'confirm-password'), /minLength="15"/);
});

test('key recovery works without configured email and does not ask for an email address', () => {
  const html = render(AccountRecovery, { mode: 'request', available: true, emailAvailable: false });
  assert.match(html, /Recovery key/);
  assert.match(html, /Email link/);
  assert.match(input(html, 'recovery-username'), /autoComplete="username"/);
  assert.match(input(html, 'recovery-key'), /type="password"/);
  assert.match(input(html, 'recovery-key'), /autoComplete="off"/);
  assert.match(input(html, 'recovery-key'), /maxLength="512"/);
  assert.match(input(html, 'reset-password'), /minLength="15"/);
  assert.equal(input(html, 'recovery-email'), '');
  assert.match(html, /lose both your password and recovery key/);
});

test('an email reset token never appears in rendered fields, links, or text', () => {
  const token = 'private-email-token-sentinel';
  const html = render(AccountRecovery, { mode: 'reset', available: true, emailAvailable: true, initialToken: token });
  assert.equal(html.includes(token), false);
  assert.equal(input(html, 'recovery-key'), '');
  assert.match(input(html, 'reset-password'), /autoComplete="new-password"/);
  assert.match(html, /Save new password/);
});

test('an authenticated recovery key is not mounted before checking the current account', () => {
  const secret = 'sensitive-recovery-key-sentinel';
  const html = render(RecoveryKeyPanel, { recoveryKey: secret, username: account.username, accountId: account.userId, onDone() {}, onAccountChanged() {} });
  assert.equal(html.includes(secret), false, 'A key must not reach markup before the account identity check');
  assert.match(html, /Checking your account/);
  assert.equal(html.includes('Copy key'), false);
});

test('a successful recovery requires acknowledging the replacement key before continuing', () => {
  const secret = 'replacement-key-sentinel';
  const html = render(RecoveryKeyPanel, { recoveryKey: secret, username: account.username, replacing: true, onDone() {} });
  assert.match(html, /previous key no longer works/);
  assert.match(html, /Copy key/);
  assert.match(html, /Download key/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>I saved my key/);
  assert.equal(html.includes('href="' + secret), false);
  assert.match(html, /losing both your password and this key/);
});
