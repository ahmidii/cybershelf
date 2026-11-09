import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../auth-contract';

// One 32 MiB derivation at a time keeps concurrent account requests within a
// Worker's memory budget. The bounded queue also avoids accumulating unlimited
// password work while the request-level rate limiter handles abusive clients.
const MAX_PENDING_DERIVATIONS = 8;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_DERIVATION_MEMORY = 40 * 1024 * 1024;
const CURRENT = { N: 32768, r: 8, p: 3 } as const;
const LEGACY = { N: 16384, r: 16, p: 1 } as const;
const PREFIX = 'cs_scrypt_v1$32768$8$3$';
const VERSIONED_HASH = /^cs_scrypt_v1\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const LEGACY_HASH = /^([a-f0-9]{32}):([a-f0-9]{128})$/;
let deriving = false;
const waiting: Array<() => void> = [];

export class PasswordWorkLimitError extends Error {
  constructor() {
    super('Account sign-in is busy. Please try again shortly.');
    this.name = 'PasswordWorkLimitError';
  }
}

async function withDerivation<T>(operation: () => Promise<T>): Promise<T> {
  if (deriving) {
    if (waiting.length >= MAX_PENDING_DERIVATIONS) throw new PasswordWorkLimitError();
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  deriving = true;
  try { return await operation(); }
  finally {
    const next = waiting.shift();
    // Keep the slot reserved until the oldest waiter resumes. A new request
    // cannot jump the queue or briefly start a second 32 MiB derivation.
    if (next) next();
    else deriving = false;
  }
}

function derive(password: string, salt: string | Uint8Array, parameters: typeof CURRENT | typeof LEGACY): Promise<Buffer> {
  return withDerivation(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { ...parameters, maxmem: MAX_DERIVATION_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
}

/** Hashing deliberately does not enforce the new-password policy: Better Auth
 * also hashes a failed sign-in's input to avoid account-existence timing leaks.
 * Existing short passwords remain verifiable; new credentials must separately
 * pass validateNewAccountPassword at their creation/change/reset boundary. */
export async function hashAccountPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length > AUTH_PASSWORD_MAX_LENGTH) throw new Error('Password input is outside the supported limits.');
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, CURRENT);
  try { return `${PREFIX}${salt.toString('hex')}$${key.toString('hex')}`; }
  finally { key.fill(0); }
}

/** Only two fixed, bounded formats are accepted. Parameters embedded in an
 * untrusted or corrupted database value can never raise the derivation cost. */
export async function verifyAccountPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (typeof hash !== 'string' || hash.length > 256 || typeof password !== 'string' || password.length > AUTH_PASSWORD_MAX_LENGTH) return false;
  const current = VERSIONED_HASH.exec(hash);
  const legacy = current ? null : LEGACY_HASH.exec(hash);
  if (!current && !legacy) return false;
  const matched = current ?? legacy!;
  const expected = Buffer.from(matched[2], 'hex');
  // Better Auth's original helper passed the salt's hexadecimal *text* to
  // scrypt. Decoding that legacy salt as bytes would lock out existing users.
  const salt = current ? Buffer.from(matched[1], 'hex') : matched[1];
  const actual = await derive(password, salt, current ? CURRENT : LEGACY);
  try { return timingSafeEqual(actual, expected); }
  finally { actual.fill(0); expected.fill(0); }
}

const COMMON_PASSWORDS = new Set([
  'password', 'passwordpassword', 'passwordpasswordpassword', 'thisismypassword',
  'mypassword', 'defaultpassword', 'changeme', 'letmein', 'iloveyou', 'welcome',
  'welcometocybershelf', 'cybershelf', 'qwerty', 'qwertyuiopasdfgh', 'qwertyuiopasdfghjkl',
  'correcthorsebatterystaple', 'trustnoone', 'adminadmin', 'administrator',
]);
const compact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export type PasswordAccountContext = { username?: string; email?: string; name?: string };

/** A small, local predictability screen, not a comprehensive breached-password
 * database. No password or digest is sent to another service. */
export function validateNewAccountPassword(password: string, context: PasswordAccountContext = {}): string | null {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length > AUTH_PASSWORD_MAX_LENGTH) return `Use at most ${AUTH_PASSWORD_MAX_LENGTH} characters for your password.`;
  if ([...password].length < AUTH_PASSWORD_MIN_LENGTH) return `Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
  const normalized = compact(password);
  const visibleCharacters = password.normalize('NFKC').toLowerCase().replace(/\s/gu, '');
  const withoutTrailingNumbers = normalized.replace(/[0-9]+$/, '');
  const repeated = /^(\S{1,16})\1+$/u.test(visibleCharacters);
  const sequential = normalized.length >= 8 && ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', 'qwertyuiopasdfghjklzxcvbnm']
    .some(sequence => sequence.repeat(14).includes(normalized));
  if (!visibleCharacters || COMMON_PASSWORDS.has(normalized) || COMMON_PASSWORDS.has(withoutTrailingNumbers) || repeated || sequential) {
    return 'Choose a less predictable passphrase. Avoid common passwords and repeated or sequential characters.';
  }
  const emailName = typeof context.email === 'string' ? context.email.split('@')[0] : undefined;
  const accountParts = [context.username, emailName, context.name];
  const identifiers = accountParts.filter((value): value is string => typeof value === 'string').map(value => compact(value.slice(0, 256))).filter(value => value.length >= 4);
  if (identifiers.some(value => normalized === value
    || (normalized.startsWith(value) && /^[0-9]+$/.test(normalized.slice(value.length)))
    || (normalized.endsWith(value) && /^[0-9]+$/.test(normalized.slice(0, -value.length))))) {
    return 'Choose a passphrase that is not based on your username, name, or email address.';
  }
  return null;
}
