// Public account-input rules only. No credentials, hashes, or runtime bindings.
export const AUTH_USERNAME_MIN_LENGTH = 3;
export const AUTH_USERNAME_MAX_LENGTH = 30;
export const ACCOUNT_FRESH_SESSION_SECONDS = 15 * 60;
export const INTERNAL_ACCOUNT_EMAIL_DOMAIN = 'accounts.cybershelf.invalid';

const reservedUsernames = new Set([
  'admin', 'administrator', 'cybershelf', 'support', 'help', 'moderator', 'mod',
  'staff', 'system', 'security', 'official', 'root', 'api', 'account', 'accounts',
  'login', 'logout', 'signin', 'signup', 'settings', 'privacy', 'terms', 'abuse',
]);

export function normalizeUsername(value: string): string { return value.trim().toLowerCase(); }

export function usernameValidationError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Choose a username of 3–30 characters.';
  const username = normalizeUsername(value);
  if (username.length < AUTH_USERNAME_MIN_LENGTH || username.length > AUTH_USERNAME_MAX_LENGTH) return 'Choose a username of 3–30 characters.';
  if (!/^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/.test(username)) return 'Use letters, numbers, and underscores, with a letter or number at each end.';
  if (reservedUsernames.has(username)) return 'That username is reserved. Please choose another.';
  return null;
}

export function isInternalAccountEmail(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase().endsWith('@' + INTERNAL_ACCOUNT_EMAIL_DOMAIN);
}

export function genuineAccountEmail(value: string): string | null {
  return isInternalAccountEmail(value) ? null : value;
}
