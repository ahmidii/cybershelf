import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_LIFECYCLE_RULE_ID, ensureBackupBucket, planBackupLifecycle, requestBackupApi } from '../scripts/ensure-backup-bucket.mjs';

const ACCOUNT = 'c'.repeat(32), TOKEN = 'synthetic-ci-token-never-log';
const config = { account_id: ACCOUNT, r2_buckets: [{ binding: 'BUCKET', bucket_name: 'cybershelf-files' }, { binding: 'BACKUP_BUCKET', bucket_name: 'cybershelf-backups' }] };
const env = { CLOUDFLARE_API_TOKEN: TOKEN };
const root = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/r2/buckets';
const backup = root + '/cybershelf-backups';
const good = result => ({ ok: true, status: 200, result });
const unrelated = { id: 'multipart-cleanup', enabled: true, conditions: { prefix: 'private/' }, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86400 } } };
const expiry = { id: BACKUP_LIFECYCLE_RULE_ID, enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 30 * 86400 } } };

function fixture({ exists = true, rules = [], managed = false, domains = [], locks = [] } = {}) {
  const calls = [];
  let saved = structuredClone(rules), present = exists;
  return {
    calls, get rules() { return saved; },
    async request(input) {
      calls.push(structuredClone(input));
      assert.equal(input.token, TOKEN);
      assert.ok(input.url === root || input.url.startsWith(backup));
      assert.ok(!input.url.includes('cybershelf-files'));
      if (input.url === root) {
        assert.equal(input.method, 'POST');
        assert.deepEqual(input.body, { name: 'cybershelf-backups' });
        assert.equal(present, false);
        present = true;
        return { ok: true, status: 201, result: { name: 'cybershelf-backups', jurisdiction: 'default' } };
      }
      if (input.url === backup) return present ? good({ name: 'cybershelf-backups', jurisdiction: 'default' }) : { ok: false, status: 404 };
      if (input.url.endsWith('/domains/managed')) { assert.equal(input.method, 'GET'); return good({ enabled: managed }); }
      if (input.url.endsWith('/domains/custom')) { assert.equal(input.method, 'GET'); return good({ domains }); }
      if (input.url.endsWith('/lock')) { assert.equal(input.method, 'GET'); return good({ rules: locks }); }
      assert.ok(input.url.endsWith('/lifecycle'));
      if (input.method === 'PUT') { saved = structuredClone(input.body.rules); return good(null); }
      assert.equal(input.method, 'GET');
      return good({ rules: structuredClone(saved) });
    },
  };
}

test('backup provisioning creates only the separate target, preserves other rules, verifies privacy and becomes idempotent', async () => {
  const remote = fixture({ exists: false, rules: [unrelated] });
  const first = await ensureBackupBucket({ config, env, request: remote.request });
  assert.deepEqual(first, { created: true, private: true, lifecycleConfigured: true, lifecycleChanged: true });
  assert.deepEqual(remote.rules, [unrelated, expiry]);
  assert.equal(remote.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(remote.calls.filter(call => call.method === 'PUT').length, 1);
  assert.ok(remote.calls.filter(call => call.method !== 'GET').every(call => call.url === root || call.url === backup + '/lifecycle'));
  const offset = remote.calls.length;
  assert.deepEqual(await ensureBackupBucket({ config, env, request: remote.request }), { created: false, private: true, lifecycleConfigured: true, lifecycleChanged: false });
  assert.ok(remote.calls.slice(offset).every(call => call.method === 'GET'));
  assert.deepEqual(remote.rules[0], unrelated);
  assert.ok(!JSON.stringify(first).includes(TOKEN));
});

test('an equivalent existing expiry is accepted without renaming it or rewriting unrelated lifecycle', async () => {
  const existing = { ...expiry, id: 'operator-configured-30-days' };
  const remote = fixture({ rules: [unrelated, existing] });
  const result = await ensureBackupBucket({ config, env, request: remote.request });
  assert.equal(result.lifecycleChanged, false);
  assert.ok(remote.calls.every(call => call.method === 'GET'));
  assert.deepEqual(remote.rules, [unrelated, existing]);
  assert.throws(() => planBackupLifecycle({ rules: [{ ...expiry, enabled: false }] }), /conflicts/);
  assert.throws(() => planBackupLifecycle({ rules: [{ ...expiry, conditions: { prefix: 'partial/' } }] }), /conflicts/);
  assert.throws(() => planBackupLifecycle({ rules: [{ ...expiry, conditions: { prefix: '', unexpectedScope: 'subset' } }] }), /conflicts/);
});

test('existing public access, malformed privacy or retention locks stop without changing that bucket', async () => {
  for (const options of [{ managed: true }, { domains: [{ domain: 'unexpected.example.invalid', enabled: true }] }, { managed: null }, { locks: [{ id: 'existing-lock', enabled: true }] }]) {
    const remote = fixture(options);
    await assert.rejects(ensureBackupBucket({ config, env, request: remote.request }), /public access|metadata was incomplete|retention lock/);
    assert.ok(remote.calls.every(call => call.method === 'GET'));
  }
});

test('permission failures never trigger speculative creation or leak provider diagnostics', async () => {
  for (const failure of [{ ok: false, status: 403, result: { message: TOKEN } }, { ok: true, status: 200, result: { name: 'wrong-target-' + TOKEN } }]) {
    const calls = [];
    await assert.rejects(ensureBackupBucket({ config, env, request: async input => { calls.push(input); return failure; } }), error => /Could not verify the configured backup bucket/.test(error.message) && !error.message.includes(TOKEN));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  }
  await assert.rejects(ensureBackupBucket({ config, env, request: async () => { throw new Error(TOKEN); } }), error => !error.message.includes(TOKEN));
});

test('observed concurrent lifecycle changes and conflicting managed rules are never overwritten', async () => {
  const remote = fixture({ rules: [unrelated] });
  let reads = 0;
  await assert.rejects(ensureBackupBucket({ config, env, request: async input => {
    const result = await remote.request(input);
    if (input.url.endsWith('/lifecycle') && input.method === 'GET' && ++reads === 2) result.result.rules.push({ ...unrelated, id: 'concurrent-operator-rule' });
    return result;
  } }), /changed during deployment/);
  assert.ok(remote.calls.every(call => call.method === 'GET'));
  const conflicting = fixture({ rules: [unrelated, { ...expiry, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 90 * 86400 } } }] });
  await assert.rejects(ensureBackupBucket({ config, env, request: conflicting.request }), /conflicts/);
  assert.ok(conflicting.calls.every(call => call.method === 'GET'));
});

test('an unconfirmed lifecycle save halts deployment and does not attempt a second destructive rewrite', async () => {
  const remote = fixture({ rules: [unrelated] });
  let writes = 0;
  await assert.rejects(ensureBackupBucket({ config, env, request: async input => {
    const result = await remote.request(input);
    if (input.method === 'PUT') writes++;
    if (writes && input.url.endsWith('/lifecycle') && input.method === 'GET') return good({ rules: [expiry] });
    return result;
  } }), /saved backup lifecycle did not match/);
  assert.equal(writes, 1);
});

test('missing credentials, ambiguous accounts and primary-bucket targeting fail before API mutation', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('Must not contact Cloudflare'); };
  await assert.rejects(ensureBackupBucket({ config, env: {}, request }), /build API token is unavailable/);
  const same = { ...config, r2_buckets: config.r2_buckets.map(binding => ({ ...binding, bucket_name: 'cybershelf-files' })) };
  await assert.rejects(ensureBackupBucket({ config: same, env, request }), /separate from the primary/);
  const ambiguous = { ...config }; delete ambiguous.account_id;
  await assert.rejects(ensureBackupBucket({ config: ambiguous, env, request, runPrivate: async args => {
    assert.deepEqual(args, ['whoami', '--json', '--config', 'wrangler.jsonc']);
    return { status: 0, stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: ACCOUNT }, { id: 'd'.repeat(32) }] }) };
  } }), /unambiguously/);
  await assert.rejects(ensureBackupBucket({ config, env: { ...env, CLOUDFLARE_ACCOUNT_ID: 'd'.repeat(32) }, request }), /inconsistent/);
  assert.equal(calls, 0);
  const remote = fixture({ rules: [expiry] });
  const result = await ensureBackupBucket({ config: ambiguous, env, request: remote.request, runPrivate: async () => ({ status: 0, stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: ACCOUNT }] }) }) });
  assert.equal(result.private, true);
});

test('the provisioning transport rejects unsafe endpoints and methods, never follows redirects and discards error bodies', async () => {
  let calls = 0, cancelled = false, bodyRead = false;
  const failed = await requestBackupApi({ url: backup, token: TOKEN }, async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    return { ok: false, status: 403, body: { cancel: async () => { cancelled = true; }, getReader() { bodyRead = true; throw new Error(TOKEN); } } };
  });
  assert.deepEqual(failed, { ok: false, status: 403 });
  assert.equal(cancelled, true);
  assert.equal(bodyRead, false);
  const noFetch = async () => { throw new Error('Must refuse before fetch'); };
  for (const input of [{ url: 'https://other.example.invalid/collect', method: 'GET' }, { url: backup, method: 'DELETE' }, { url: backup + '/domains/managed', method: 'PUT' }, { url: backup + '?token=' + TOKEN, method: 'GET' }]) {
    assert.deepEqual(await requestBackupApi({ token: TOKEN, ...input }, noFetch), { ok: false, status: 0 });
  }
  const written = await requestBackupApi({ url: backup + '/lifecycle', method: 'PUT', token: TOKEN, body: { rules: [expiry] } }, async (url, options) => {
    calls++;
    assert.equal(options.headers['cf-r2-data-catalog-check'], 'true');
    assert.deepEqual(JSON.parse(options.body), { rules: [expiry] });
    return new Response(JSON.stringify({ success: true, result: null }), { status: 200 });
  });
  assert.deepEqual(written, { ok: true, status: 200, result: null });
  const oversized = await requestBackupApi({ url: backup, token: TOKEN }, async () => new Response('x'.repeat(300 * 1024)));
  assert.equal(oversized.ok, false);
  assert.equal(calls, 2);
});
