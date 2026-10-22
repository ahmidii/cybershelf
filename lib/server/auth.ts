import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../db/schema';
import { AUTH_EMAIL_MAX_LENGTH, AUTH_NAME_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../auth-contract';

export type AuthBindings = {
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
export function createAuth(bindings: AuthBindings) {
  const config = authConfiguration(bindings);
  const db = drizzle(config.database, { schema });
  return betterAuth({
    appName: 'cybershelf',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      // Basic accounts work without an email service. Addresses remain
      // unverified; verification and password recovery are not advertised.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
    },
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
      },
    },
    advanced: {
      cookiePrefix: 'cybershelf',
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
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
