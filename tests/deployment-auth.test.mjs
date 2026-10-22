import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAuthSecret } from '../scripts/ensure-auth-secret.mjs';

test('deployment preserves an existing auth secret without reading, generating, or replacing it', () => {
  const calls = [];
  const result = ensureAuthSecret({
    buildSecret: 'short value is irrelevant when a runtime key already exists',
    generate: () => { throw new Error('Must not generate a replacement.'); },
    runPrivate(args, input) {
      calls.push({ args, input });
      return { status: 0, stdout: JSON.stringify([{ name: 'BETTER_AUTH_SECRET', type: 'secret_text' }]) };
    },
  });
  assert.equal(result, 'existing');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, undefined);
});

test('first deployment installs a strong random secret through stdin only', () => {
  const calls = [];
  const result = ensureAuthSecret({
    runPrivate(args, input) {
      calls.push({ args, input });
      return { status: 0, stdout: '[]' };
    },
  });
  assert.equal(result, 'created');
  assert.equal(calls.length, 2);
  assert.match(calls[1].input, /^[A-Za-z0-9_-]{64}$/);
  assert.deepEqual(calls[1].args, ['secret', 'put', 'BETTER_AUTH_SECRET', '--config', 'wrangler.jsonc']);
  assert.ok(!calls[1].args.includes(calls[1].input));
});

test('a working legacy runtime key is preserved even when absent from the encrypted-secret list', () => {
  let calls = 0;
  const result = ensureAuthSecret({ accountsAvailable: true, configPath: 'dist/server/wrangler.json',
    generate: () => { throw new Error('Do not replace a working key.'); },
    runPrivate(args) {
      calls++;
      assert.equal(args.at(-1), 'dist/server/wrangler.json');
      return { status: 0, stdout: '[]' };
    },
  });
  assert.equal(result, 'runtime-existing');
  assert.equal(calls, 1);
});

test('a valid build-only secret is promoted to runtime without disclosure', () => {
  const secret = 'test-only-build-value-with-more-than-32-characters';
  let inputSeen;
  assert.equal(ensureAuthSecret({ buildSecret: secret, runPrivate(args, input) {
    if (args[1] === 'put') inputSeen = input;
    return { status: 0, stdout: '[]' };
  } }), 'created');
  assert.equal(inputSeen, secret);
});

test('failed or malformed remote checks never generate or overwrite credentials', () => {
  for (const listed of [
    { status: 1, stderr: 'provider diagnostics deliberately withheld' },
    { status: 0, stdout: 'not json' },
    { status: 0, stdout: '{}' },
    { status: 0, stdout: '[{"name":"BETTER_AUTH_SECRET"}]' },
  ]) {
    let calls = 0;
    assert.throws(() => ensureAuthSecret({
      generate: () => { throw new Error('must not generate'); },
      runPrivate: () => { calls++; return listed; },
    }), /Could not check|unreadable|unexpected/);
    assert.equal(calls, 1);
  }
});

test('invalid configured build secrets stop without publishing any secret value', () => {
  for (const buildSecret of ['', 'short', 'a'.repeat(40) + '\nmalformed', 'a'.repeat(40) + '\0']) {
    let calls = 0;
    assert.throws(() => ensureAuthSecret({ buildSecret, runPrivate: () => {
      calls++; return { status: 0, stdout: '[]' };
    } }), /single-line random value/);
    assert.equal(calls, 1);
  }
});

test('provider errors cannot echo a generated authentication credential into build errors', () => {
  const secret = 'test-only-secret-that-provider-must-never-disclose';
  assert.throws(() => ensureAuthSecret({ generate: () => secret, runPrivate(args) {
    return args[1] === 'list' ? { status: 0, stdout: '[]' }
      : { status: 1, stdout: secret, stderr: secret, error: new Error(secret) };
  } }), error => !String(error).includes(secret) && /Could not configure/.test(String(error)));
});
