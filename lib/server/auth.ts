import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../db/schema';
import { AUTH_EMAIL_MAX_LENGTH, AUTH_NAME_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../auth-contract';
import { authEmailConfiguration, sendAuthEmail, type AuthEmailBindings, type AuthEmailPurpose } from './auth-email';

export type AuthBindings = AuthEmailBindings & {
  DB?: D1Database;
  APP_ORIGIN?: string;
  BETTER_AUTH_SECRET?: string;
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

export function authConfiguration(bindings: AuthBindings) {
  if (!bindings.DB) throw new AuthConfigurationError('Cloudflare D1 binding DB is missing.');
  const secret = bindings.BETTER_AUTH_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new AuthConfigurationError('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters.');
  }
  let url: URL;
  try {
    url = new URL(bindings.APP_ORIGIN ?? '');
  } catch {
    throw new AuthConfigurationError('Set APP_ORIGIN to the public origin of cybershelf.');
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new AuthConfigurationError('APP_ORIGIN must be an HTTPS origin, or HTTP localhost for local development.');
  }
  return { database: bindings.DB, origin: url.origin, secret, secureCookies: url.protocol === 'https:' };
}

// Construct inside the request context: D1 bindings are scoped to the Worker.
// Never infer identity, trusted origins, or cookie configuration from headers.
export function createAuth(bindings: AuthBindings, waitUntil?: (promise: Promise<unknown>) => void) {
  const config = authConfiguration(bindings);
  const emailConfig = authEmailConfiguration(bindings);
  const db = drizzle(config.database, { schema });
  const queueEmail = async (purpose: AuthEmailPurpose, data: { user: { email: string }; url: string }) => {
    if (!emailConfig) return;
    const delivery = sendAuthEmail(emailConfig, { purpose, to: data.user.email, origin: config.origin, url: data.url }).catch(() => {
      // Never disclose account existence through provider errors or log links,
      // addresses, credentials, provider payloads, or reset/verification tokens.
      console.error('cybershelf account email delivery failed');
    });
    if (waitUntil) waitUntil(delivery);
    else await delivery;
  };
  return betterAuth({
    appName: 'cybershelf',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.origin],
    // Dependency errors can include database parameters. Keep production auth
    // diagnostics useful without emitting account details or credential material.
    logger: { level: 'error', log: () => console.error('cybershelf authentication service reported an error') },
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      // Keep existing accounts usable while confirmation is introduced. Email
      // readiness is separate from account readiness; no-mail installs still work.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      ...(emailConfig ? {
        resetPasswordTokenExpiresIn: 60 * 60,
        sendResetPassword: (data: { user: { email: string }; url: string }) => queueEmail('password-reset', data),
      } : {}),
    },
    ...(emailConfig ? { emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      // Confirmation must not silently replace another account's browser session.
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: (data: { user: { email: string }; url: string }) => queueEmail('verify-email', data),
    } } : {}),
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'cybershelf',
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      ...(waitUntil ? { backgroundTasks: { handler: waitUntil } } : {}),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const name = user.name.trim();
            if (!name || name.length > AUTH_NAME_MAX_LENGTH || user.email.length > AUTH_EMAIL_MAX_LENGTH) {
              throw new APIError('BAD_REQUEST', { code: 'INVALID_ACCOUNT_DETAILS', message: 'Use a name of 1–80 characters and a valid email address.' });
            }
            return { data: { ...user, name, emailVerified: false } };
          },
        },
        update: {
          before: async (user) => {
            if (user.name !== undefined && (!user.name.trim() || user.name.trim().length > AUTH_NAME_MAX_LENGTH)) {
              throw new APIError('BAD_REQUEST', { code: 'INVALID_NAME', message: 'Use a name of 1–80 characters.' });
            }
            return { data: { ...user, ...(user.name === undefined ? {} : { name: user.name.trim() }) } };
          },
        },
      },
    },
  });
}
