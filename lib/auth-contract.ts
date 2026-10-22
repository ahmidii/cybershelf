// Shared by the sign-in form and server. This module contains no credentials
// or runtime bindings and is safe to import into browser components.
export const AUTH_PASSWORD_MIN_LENGTH = 12;
export const AUTH_PASSWORD_MAX_LENGTH = 128;
export const AUTH_NAME_MAX_LENGTH = 80;
export const AUTH_EMAIL_MAX_LENGTH = 254;
export const ACCOUNT_ID_HEADER = 'X-Cybershelf-Account';

export function safeRelativeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // Browsers normalize backslashes and controls in URLs. Reject them before
  // parsing so an apparently relative return path cannot become another host.
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://cybershelf.invalid');
    if (url.origin !== 'https://cybershelf.invalid') return '/';
    const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    if (pathname === '/signin' || pathname === '/api/auth' || pathname.startsWith('/api/auth/')
      || pathname === '/signin-with-chatgpt' || pathname === '/signout-with-chatgpt' || pathname === '/callback') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function signInPath(returnTo: string = '/'): string {
  return `/signin?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}
