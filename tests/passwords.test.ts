import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashAccountPassword, PasswordWorkLimitError, validateNewAccountPassword, verifyAccountPassword } from '../lib/server/passwords';

// Produced by the released Better Auth 1.7.8 algorithm, which passed the
// hexadecimal salt as text. This is a synthetic 12-character legacy password.
const legacyHash = '0123456789abcdef0123456789abcdef:57affd10380409758f367869d68e1ecc4cb021c67e86a84036865b67472cc4670c8f3e29134ea6f9cdac4cf3984ffde0790496df8ddfb62ed3969038fab719ba';

test('new passwords use a versioned scrypt format with independent random salts', async () => {
  const password = 'A quiet forest after rain';
  const first = await hashAccountPassword(password), second = await hashAccountPassword(password);
  assert.match(first, /^cs_scrypt_v1\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyAccountPassword({ hash: first, password }), true);
  assert.equal(await verifyAccountPassword({ hash: first, password: 'A different forest after rain' }), false);
  assert.equal(first.includes(password), false);
});

test('legacy Better Auth hashes keep authenticating valid 12-character passwords', async () => {
  assert.equal('legacyPass12'.length, 12);
  assert.equal(await verifyAccountPassword({ hash: legacyHash, password: 'legacyPass12' }), true);
  assert.equal(await verifyAccountPassword({ hash: legacyHash, password: 'legacyPass13' }), false);
  assert.match(validateNewAccountPassword('legacyPass12')!, /at least 15/);
  // Dummy hashing during failed sign-in is allowed to use an old short input;
  // only the new-credential boundary enforces the stronger policy.
  const dummy = await hashAccountPassword('legacyPass12');
  assert.equal(await verifyAccountPassword({ hash: dummy, password: 'legacyPass12' }), true);
});

test('password derivation preserves the legacy NFKC normalization contract', async () => {
  const hash = await hashAccountPassword('Ｆｏｒｅｓｔ nights are quiet');
  assert.equal(await verifyAccountPassword({ hash, password: 'Forest nights are quiet' }), true);
  assert.equal(await verifyAccountPassword({ hash, password: 'forest nights are quiet' }), false, 'Passwords remain case sensitive');
});

test('malformed hashes and unbounded inputs never select attacker-chosen scrypt parameters', async () => {
  const malformed = ['', '0'.repeat(1000), legacyHash + ':extra', legacyHash.toUpperCase(),
    'cs_scrypt_v2$32768$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(128),
    'cs_scrypt_v1$1073741824$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(128),
    'cs_scrypt_v1$32768$8$1$' + '0'.repeat(32) + '$' + '0'.repeat(128),
    'cs_scrypt_v1$32768$8$3$' + '0'.repeat(31) + '$' + '0'.repeat(128)];
  for (const hash of malformed) assert.equal(await verifyAccountPassword({ hash, password: 'A quiet forest after rain' }), false);
  assert.equal(await verifyAccountPassword({ hash: legacyHash, password: 'x'.repeat(129) }), false);
  await assert.rejects(hashAccountPassword('x'.repeat(129)), /outside the supported limits/);
});

test('new-password policy accepts long passphrases, Unicode and punctuation without composition rules', () => {
  const exactlyFifteen = 'quiet lake moon';
  assert.equal(exactlyFifteen.length, 15);
  assert.equal(validateNewAccountPassword(exactlyFifteen), null);
  assert.match(validateNewAccountPassword(exactlyFifteen.slice(0, -1))!, /at least 15/);
  const prefix = 'A safe initial phrase ';
  const maximum = prefix + 'x'.repeat(128 - prefix.length);
  assert.equal(validateNewAccountPassword(maximum), null);
  assert.match(validateNewAccountPassword(maximum + 'x')!, /at most 128/);
  assert.match(validateNewAccountPassword('📚🌿🌙✨🍃☀️🦊')!, /at least 15/, 'A surrogate pair does not count as two characters');
  assert.equal(validateNewAccountPassword('森の静かな夜に長い物語を読み続ける'), null);
  assert.equal(validateNewAccountPassword('!@#$%^&*()_+{}:?><'), null, 'Symbols are allowed without requiring letters or digits');
  assert.equal(validateNewAccountPassword('a calm afternoon beneath the trees'), null);
});

test('local predictability checks reject common, repeated, sequential and account-derived passwords', () => {
  for (const password of ['Password123456789!', 'correct horse battery staple', 'aaaaaaaaaaaaaaa', 'abcabcabcabcabc', '0123456789012345', 'abcdefghijklmnop', '               ', '!!!!!!!!!!!!!!!']) {
    assert.match(validateNewAccountPassword(password)!, /less predictable/, password);
  }
  assert.match(validateNewAccountPassword('bookworm123456789', { username: 'Bookworm' })!, /account|username/);
  assert.match(validateNewAccountPassword('123456789bookworm', { email: 'bookworm@example.invalid' })!, /account|username/);
  assert.match(validateNewAccountPassword('A Reader12345678', { name: 'A Reader' })!, /account|username/);
  assert.equal(validateNewAccountPassword('bookworm enjoys a long rainy afternoon', { username: 'Bookworm' }), null, 'A context word inside a longer independent phrase is not forbidden');
});

test('concurrent password work has a bounded queue and releases its slot after overload', async () => {
  const password = 'A synthetic queue test passphrase';
  const results = await Promise.allSettled(Array.from({ length: 11 }, () => hashAccountPassword(password)));
  const completed = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.equal(completed.length, 9, 'One derivation plus eight pending requests are accepted');
  assert.equal(rejected.length, 2);
  for (const result of rejected) {
    assert.ok(result.reason instanceof PasswordWorkLimitError);
    assert.equal(result.reason.message, 'Account sign-in is busy. Please try again shortly.');
    assert.equal(result.reason.message.includes(password), false);
  }
  assert.equal(await verifyAccountPassword({ hash: legacyHash, password: 'legacyPass12' }), true, 'A full queue cannot strand the next account request');
});
