import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalRecoveryKey, generateRecoveryKey, hashRecoveryKey } from '../lib/server/recovery-keys';

test('recovery keys contain 32 random bytes and are independently generated', () => {
  const first = generateRecoveryKey(), second = generateRecoveryKey();
  assert.match(first, /^csrk_[a-f0-9]{8}(?:-[a-f0-9]{8}){7}$/);
  assert.match(canonicalRecoveryKey(first)!, /^csrk_[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test('copying whitespace, letter case or printed separators does not destroy a valid recovery key', async () => {
  const key = generateRecoveryKey();
  const copied = '  ' + key.toUpperCase().replaceAll('-', ' -\n') + '\n';
  assert.equal(canonicalRecoveryKey(copied), canonicalRecoveryKey(key));
  const hash = await hashRecoveryKey(key);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await hashRecoveryKey(copied), hash);
  assert.notEqual(await hashRecoveryKey(generateRecoveryKey()), hash);
  assert.equal(hash.includes(key), false);
});

test('malformed and unbounded recovery credentials are rejected before lookup', async () => {
  for (const value of [null, 123, '', 'csrk_' + 'a'.repeat(63), 'csrk_' + 'a'.repeat(65), 'csrk_' + 'z'.repeat(64), 'other_' + 'a'.repeat(64), ' '.repeat(513)]) {
    assert.equal(canonicalRecoveryKey(value), null);
  }
  await assert.rejects(hashRecoveryKey('csrk_not-a-secret'), /Invalid recovery key/);
});
