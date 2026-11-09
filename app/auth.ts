import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signInPath } from '../lib/auth-contract';
import { AuthConfigurationError, authConfiguration, createAuth } from '../lib/server/auth';
import { authEmailConfiguration } from '../lib/server/auth-email';
import { genuineAccountEmail } from '../lib/account-identity';

export type CurrentUser = {
  userId: string;
  displayName: string;
  email: string | null;
  username: string | null;
  fullName: string | null;
  emailVerified: boolean;
};

export function getAuthAvailability(): { available: boolean; emailAvailable: boolean } {
  try {
    authConfiguration(env);
    return { available: true, emailAvailable: !!authEmailConfiguration(env) };
  } catch (error) {
    if (error instanceof AuthConfigurationError) return { available: false, emailAvailable: false };
    throw error;
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const requestHeaders = new Headers(await headers());
  if (!requestHeaders.get('cookie') || !getAuthAvailability().available) return null;
  const session = await createAuth(env).api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return {
    userId: session.user.id,
    displayName: session.user.name || session.user.username || 'Reader',
    email: genuineAccountEmail(session.user.email),
    username: session.user.username ?? null,
    fullName: session.user.name || null,
    emailVerified: session.user.emailVerified,
  };
}

export async function requireCurrentUser(returnTo = '/'): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(signInPath(returnTo));
}
