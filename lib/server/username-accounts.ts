import { ACCOUNT_ID_HEADER, AUTH_PASSWORD_MAX_LENGTH } from '../auth-contract';
import { ACCOUNT_FRESH_SESSION_SECONDS, INTERNAL_ACCOUNT_EMAIL_DOMAIN, normalizeUsername, usernameValidationError } from '../account-identity';
import { authConfiguration, AuthConfigurationError, createAuth, type AuthBindings } from './auth';
import { hashAccountPassword, PasswordWorkLimitError, validateNewAccountPassword, verifyAccountPassword } from './passwords';
import { canonicalRecoveryKey, generateRecoveryKey, hashRecoveryKey } from './recovery-keys';

const HEADERS = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
};
class AccountActionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const response = (body: unknown, status = 200, extra?: Headers) => {
  const headers = new Headers(extra);
  for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value);
  headers.delete('content-length');
  return Response.json(body, { status, headers });
};

async function handled(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof AccountActionError) return response({ code: error.code, message: error.message }, error.status);
    if (error instanceof PasswordWorkLimitError) return response({ code: 'ACCOUNT_BUSY', message: 'Account sign-in is busy. Please try again shortly.' }, 503);
    if (error instanceof AuthConfigurationError) return response({ code: 'AUTH_NOT_CONFIGURED', message: 'Account sign-in is temporarily unavailable.' }, 503);
    // Provider/database errors can contain parameters. Never log them, a body,
    // recovery credential, email, username, password, or session cookie.
    console.error('cybershelf account action failed');
    return response({ code: 'ACCOUNT_UNAVAILABLE', message: 'We could not complete this account request. Please try again.' }, 503);
  }
}

function requireOrigin(request: Request, origin: string) {
  if (request.method !== 'POST') throw new AccountActionError(405, 'METHOD_NOT_ALLOWED', 'Use a POST request.');
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AccountActionError(403, 'INVALID_ORIGIN', 'Reload cybershelf before trying this account action.');
  }
}

async function bodyOf(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AccountActionError(415, 'INVALID_REQUEST', 'Send account details as JSON.');
  if (Number(request.headers.get('content-length') ?? 0) > 8192) throw new AccountActionError(413, 'INVALID_REQUEST', 'This account request is too large.');
  if (!request.body) throw new AccountActionError(400, 'INVALID_REQUEST', 'Check your account details.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new AccountActionError(413, 'INVALID_REQUEST', 'This account request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AccountActionError(400, 'INVALID_REQUEST', 'Check your account details.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new AccountActionError(400, 'INVALID_REQUEST', 'Check your account details.');
  return body as Record<string, unknown>;
}

type Config = ReturnType<typeof authConfiguration>;

/** Fixed-window counters are updated atomically by D1. Persisted keys are HMAC
 * digests so the abuse-control table does not contain raw IPs or usernames. */
async function limitAction(config: Config, request: Request, action: string, subject: string, max = 5) {
  const now = Date.now(), windowStart = Math.floor(now / 60000) * 60000;
  const rawIP = request.headers.get('cf-connecting-ip') ?? '';
  const ip = rawIP.length <= 64 && /^[a-fA-F0-9:.]+$/.test(rawIP) ? rawIP : 'unknown';
  const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const keys = await Promise.all(['ip:' + ip, subject].map(async value => {
    const digest = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode('cybershelf.account-limit.v1\0' + action + '\0' + value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }));
  const results = await config.database.batch<{ count: number }>([
    ...keys.map(key => config.database.prepare('INSERT INTO account_action_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN MIN(count + 1, ?) ELSE 1 END, window_start = excluded.window_start RETURNING count').bind(key, windowStart, max + 1)),
    config.database.prepare('DELETE FROM account_action_limits WHERE window_start < ?').bind(windowStart - 24 * 60 * 60000),
  ]);
  const counts = results.slice(0, keys.length).map(result => Number(result.results?.[0]?.count));
  if (counts.some(count => !Number.isFinite(count))) throw new Error('Account limits unavailable.');
  if (counts.some(count => count > max)) throw new AccountActionError(429, 'RATE_LIMITED', 'A few too many attempts. Wait a minute before trying again.');
}

export async function signUpWithUsername(request: Request, bindings: AuthBindings, waitUntil?: (promise: Promise<unknown>) => void): Promise<Response> {
  return handled(async () => {
    const config = authConfiguration(bindings); requireOrigin(request, config.origin);
    const body = await bodyOf(request, ['username', 'password']);
    const invalid = usernameValidationError(body.username);
    if (invalid) throw new AccountActionError(400, 'INVALID_USERNAME', invalid);
    const username = normalizeUsername(body.username as string);
    if (typeof body.password !== 'string') throw new AccountActionError(400, 'PASSWORD_POLICY', 'Choose a password for your account.');
    const passwordError = validateNewAccountPassword(body.password, { username });
    if (passwordError) throw new AccountActionError(400, 'PASSWORD_POLICY', passwordError);
    // Reuse Better Auth's whole signup handler, including its origin checks,
    // password hashing, signed session cookie and durable signup rate limit.
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json'); headers.delete('content-length'); headers.delete('content-encoding');
    const auth = createAuth(bindings, waitUntil, { usernameSignUp: true });
    const result = await auth.handler(new Request(new URL('/api/auth/sign-up/email', config.origin), {
      method: 'POST', headers, signal: request.signal,
      body: JSON.stringify({ name: username, username, password: body.password, email: crypto.randomUUID() + '@' + INTERNAL_ACCOUNT_EMAIL_DOMAIN }),
    }));
    if (!result.ok) {
      if (result.status !== 429 && result.status < 500 && await config.database.prepare('SELECT id FROM auth_user WHERE username = ?').bind(username).first()) {
        throw new AccountActionError(409, 'USERNAME_TAKEN', 'That username is already taken. Choose another, or sign in.');
      }
      const error = await result.json().catch(() => ({})) as { code?: string; message?: string };
      return response({ code: error.code || 'SIGN_UP_FAILED', message: result.status === 429 ? 'A few too many attempts. Wait a minute before trying again.' : 'Your account could not be created. Check your details and try again.' }, result.status);
    }
    const created = await result.json() as { user: { id: string; name: string; username: string } };
    if (!created.user?.id || created.user.username !== username) throw new Error('Account signup response unavailable.');
    const recoveryKey = generateRecoveryKey(), keyHash = await hashRecoveryKey(recoveryKey), now = Date.now();
    try {
      await config.database.prepare('INSERT INTO account_recovery_keys (user_id, key_hash, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(created.user.id, keyHash, now, now).run();
    } catch {
      // Native signup has already committed the account. Preserve it and give
      // a useful recovery path instead of pretending signup never happened.
      throw new AccountActionError(503, 'ACCOUNT_CREATED_RECOVERY_UNAVAILABLE', 'Your account was created. Sign in with your username and password, then open Account & security to generate your recovery key.');
    }
    return response({ user: { id: created.user.id, name: created.user.name, username, email: null, emailVerified: false }, recoveryKey }, 200, result.headers);
  });
}

async function accountProof(request: Request, bindings: AuthBindings, currentPassword: unknown, action: string) {
  const config = authConfiguration(bindings); requireOrigin(request, config.origin);
  const session = await createAuth(bindings).api.getSession({ headers: request.headers });
  if (!session) throw new AccountActionError(401, 'UNAUTHORIZED', 'Sign in to change your account settings.');
  if (request.headers.get(ACCOUNT_ID_HEADER) !== session.user.id) throw new AccountActionError(409, 'ACCOUNT_CHANGED', 'Your signed-in account changed. Reload before changing its settings.');
  await limitAction(config, request, action, 'user:' + session.user.id);
  const age = Date.now() - new Date(session.session.createdAt).getTime();
  if (!Number.isFinite(age) || age < 0 || age >= ACCOUNT_FRESH_SESSION_SECONDS * 1000) throw new AccountActionError(403, 'FRESH_SESSION_REQUIRED', 'Sign in again before changing your account security.');
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > AUTH_PASSWORD_MAX_LENGTH) throw new AccountActionError(400, 'INVALID_PASSWORD', 'Your current password did not match.');
  const credential = await config.database.prepare("SELECT id, password FROM auth_account WHERE user_id = ? AND provider_id = 'credential' LIMIT 1").bind(session.user.id).first<{ id: string; password: string }>();
  if (!credential?.password || !await verifyAccountPassword({ hash: credential.password, password: currentPassword })) throw new AccountActionError(400, 'INVALID_PASSWORD', 'Your current password did not match.');
  return { config, session, credential };
}

// The final write rechecks both the session and the exact credential verified
// above. A reset/signout racing with password verification cannot be bypassed.
const proofSQL = "EXISTS (SELECT 1 FROM auth_session WHERE id = ? AND user_id = ? AND expires_at > ?) AND EXISTS (SELECT 1 FROM auth_account WHERE id = ? AND user_id = ? AND provider_id = 'credential' AND password = ?)";
function proofValues(proof: Awaited<ReturnType<typeof accountProof>>, now: number) {
  return [proof.session.session.id, proof.session.user.id, now, proof.credential.id, proof.session.user.id, proof.credential.password];
}

export async function replaceRecoveryKey(request: Request, bindings: AuthBindings): Promise<Response> {
  return handled(async () => {
    const config = authConfiguration(bindings); requireOrigin(request, config.origin);
    const body = await bodyOf(request, ['currentPassword']);
    const proof = await accountProof(request, bindings, body.currentPassword, 'replace-key');
    if (!proof.session.user.username) throw new AccountActionError(400, 'USERNAME_REQUIRED', 'Choose a username before generating a recovery key.');
    const recoveryKey = generateRecoveryKey(), keyHash = await hashRecoveryKey(recoveryKey), now = Date.now(), userId = proof.session.user.id;
    const changed = await config.database.prepare(`INSERT INTO account_recovery_keys (user_id, key_hash, created_at, updated_at) SELECT ?, ?, ?, ? WHERE ${proofSQL} ON CONFLICT(user_id) DO UPDATE SET key_hash = excluded.key_hash, updated_at = excluded.updated_at`).bind(userId, keyHash, now, now, ...proofValues(proof, now)).run();
    if (changed.meta.changes !== 1) throw new AccountActionError(409, 'ACCOUNT_CHANGED', 'Your account changed during this request. Sign in again before trying again.');
    return response({ recoveryKey });
  });
}

export async function claimAccountUsername(request: Request, bindings: AuthBindings): Promise<Response> {
  return handled(async () => {
    const config = authConfiguration(bindings); requireOrigin(request, config.origin);
    const body = await bodyOf(request, ['username', 'currentPassword']);
    const proof = await accountProof(request, bindings, body.currentPassword, 'claim-username');
    const invalid = usernameValidationError(body.username);
    if (invalid) throw new AccountActionError(400, 'INVALID_USERNAME', invalid);
    const username = normalizeUsername(body.username as string);
    if (proof.session.user.username) {
      if (proof.session.user.username === username) return response({ username });
      throw new AccountActionError(409, 'USERNAME_ALREADY_SET', 'Your username has already been chosen. It stays with your account.');
    }
    const now = Date.now();
    try {
      const changed = await config.database.prepare(`UPDATE auth_user SET username = ?, updated_at = ? WHERE id = ? AND username IS NULL AND ${proofSQL}`).bind(username, now, proof.session.user.id, ...proofValues(proof, now)).run();
      if (changed.meta.changes !== 1) throw new AccountActionError(409, 'ACCOUNT_CHANGED', 'Your account changed during this request. Reload before trying again.');
    } catch (error) {
      if (error instanceof Error && /unique constraint|auth_user_username_unique/i.test(error.message)) throw new AccountActionError(409, 'USERNAME_TAKEN', 'That username is already taken. Please choose another.');
      throw error;
    }
    return response({ username });
  });
}

export async function recoverUsernameAccount(request: Request, bindings: AuthBindings): Promise<Response> {
  return handled(async () => {
    const config = authConfiguration(bindings); requireOrigin(request, config.origin);
    const body = await bodyOf(request, ['username', 'recoveryKey', 'newPassword']);
    const username = typeof body.username === 'string' ? normalizeUsername(body.username).slice(0, 128) : '';
    await limitAction(config, request, 'recover', 'username:' + username);
    const invalidRecovery = () => new AccountActionError(400, 'INVALID_RECOVERY_KEY', 'Those recovery details did not match. Check your username and recovery key.');
    const canonical = canonicalRecoveryKey(body.recoveryKey);
    if (usernameValidationError(username) || !canonical) throw invalidRecovery();
    if (typeof body.newPassword !== 'string') throw new AccountActionError(400, 'PASSWORD_POLICY', 'Choose a new password for your account.');
    const passwordError = validateNewAccountPassword(body.newPassword, { username });
    if (passwordError) throw new AccountActionError(400, 'PASSWORD_POLICY', passwordError);
    const oldHash = await hashRecoveryKey(canonical);
    const account = await config.database.prepare("SELECT u.id AS user_id, a.id AS account_id, a.password FROM auth_user u JOIN account_recovery_keys k ON k.user_id = u.id JOIN auth_account a ON a.user_id = u.id AND a.provider_id = 'credential' WHERE u.username = ? AND k.key_hash = ? LIMIT 1").bind(username, oldHash).first<{ user_id: string; account_id: string; password: string }>();
    if (!account?.password) throw invalidRecovery();
    const passwordHash = await hashAccountPassword(body.newPassword);
    const recoveryKey = generateRecoveryKey(), replacementHash = await hashRecoveryKey(recoveryKey), now = Date.now();
    // One transaction claims this exact key, changes the credential, invalidates
    // pending email resets, and revokes every session. Subsequent statements
    // require this request's random replacement hash: a racing/replayed loser
    // changes no credentials, tokens or sessions, even after the first lookup.
    const claimed = 'EXISTS (SELECT 1 FROM account_recovery_keys WHERE user_id = ? AND key_hash = ?)';
    const result = await config.database.batch([
      config.database.prepare("UPDATE account_recovery_keys SET key_hash = ?, updated_at = ? WHERE user_id = ? AND key_hash = ? AND EXISTS (SELECT 1 FROM auth_account WHERE id = ? AND user_id = ? AND provider_id = 'credential' AND password = ?)").bind(replacementHash, now, account.user_id, oldHash, account.account_id, account.user_id, account.password),
      config.database.prepare(`UPDATE auth_account SET password = ?, updated_at = ? WHERE id = ? AND user_id = ? AND provider_id = 'credential' AND ${claimed}`).bind(passwordHash, now, account.account_id, account.user_id, account.user_id, replacementHash),
      config.database.prepare(`DELETE FROM auth_verification WHERE value = ? AND identifier LIKE 'reset-password:%' AND ${claimed}`).bind(account.user_id, account.user_id, replacementHash),
      config.database.prepare(`DELETE FROM auth_session WHERE user_id = ? AND ${claimed}`).bind(account.user_id, account.user_id, replacementHash),
    ]);
    if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) throw invalidRecovery();
    // Deliberately does not create a session or set a cookie. The reader signs
    // in with the new password after storing the newly rotated recovery key.
    return response({ recoveryKey });
  });
}
