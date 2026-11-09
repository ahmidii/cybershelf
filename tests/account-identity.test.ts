import assert from 'node:assert/strict';
import { test } from 'node:test';
import { genuineAccountEmail, isInternalAccountEmail, normalizeUsername, usernameValidationError } from '../lib/account-identity';

test('usernames normalize case and surrounding whitespace to one ASCII identity', () => {
  assert.equal(normalizeUsername('  Quiet_Reader42  '), 'quiet_reader42');
  for (const value of ['abc', 'a_1', 'Book_Reader', '  book_reader  ', 'a'.repeat(30)]) assert.equal(usernameValidationError(value), null, value);
});

test('usernames reject lookalikes, reserved names, ambiguous punctuation and lengths outside 3–30', () => {
  for (const value of ['', 'ab', 'a'.repeat(31), '_reader', 'reader_', 'a.b', 'a-b', 'read er', 'réader', 'ｒｅａｄｅｒ', 'read\u200ber', 'reader@domain', 'ADMIN', '  CyberShelf ', 'support', null, 123]) {
    assert.equal(typeof usernameValidationError(value), 'string', String(value));
  }
});

test('internal account identifiers are hidden without altering real legacy email addresses', () => {
  const internal = '01234567-89ab-4cde-9fab-0123456789ab@accounts.cybershelf.invalid';
  assert.equal(isInternalAccountEmail(internal.toUpperCase()), true);
  assert.equal(genuineAccountEmail(internal), null);
  for (const value of ['reader@example.invalid', 'reader@accounts.cybershelf.invalid.example', 'reader@cybershelf.io']) {
    assert.equal(isInternalAccountEmail(value), false);
    assert.equal(genuineAccountEmail(value), value);
  }
});
