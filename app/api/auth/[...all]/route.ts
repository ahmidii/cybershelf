import { env } from 'cloudflare:workers';
import { getRequestExecutionContext } from 'vinext/shims/request-context';
import { AuthConfigurationError, authConfiguration, createAuth } from '../../../../lib/server/auth';
import { ACCOUNT_ID_HEADER } from '../../../../lib/auth-contract';

export const dynamic = 'force-dynamic';

const ACCOUNT_MUTATIONS = new Set([
  '/api/auth/sign-out',
  '/api/auth/change-password',
  '/api/auth/revoke-other-sessions',
  '/api/auth/revoke-session',
  '/api/auth/revoke-sessions',
  '/api/auth/update-user',
  '/api/auth/send-verification-email',
]);
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

async function handle(request: Request): Promise<Response> {
  try {
    const context = getRequestExecutionContext();
    const auth = createAuth(env, context ? promise => context.waitUntil(promise) : undefined);
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
    if (request.method === 'POST' && ACCOUNT_MUTATIONS.has(path)) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session && request.headers.get(ACCOUNT_ID_HEADER) !== session.user.id) {
        return Response.json({ code: 'ACCOUNT_CHANGED', message: 'Your signed-in account changed. Reload before changing account settings.' }, {
          status: 409, headers: PRIVATE_HEADERS,
        });
      }
    }
    // Email links always land on the dedicated account screens. A changed URL
    // cannot redirect a reset token through another auth endpoint or page.
    if (request.method === 'GET' && (path === '/api/auth/verify-email' || /^\/api\/auth\/reset-password\/[^/]+$/.test(path))) {
      const { origin } = authConfiguration(env);
      url.searchParams.set('callbackURL', path === '/api/auth/verify-email' ? `${origin}/account?verified=1` : `${origin}/reset-password`);
      request = new Request(url, request);
    }
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return Response.json({ code: 'AUTH_NOT_CONFIGURED', message: 'Account sign-in is not available yet. Please try again later.' }, {
        status: 503, headers: PRIVATE_HEADERS,
      });
    }
    // Do not include queries, credentials, or session cookies in error output.
    console.error('cybershelf authentication request failed');
    return Response.json({ code: 'AUTH_UNAVAILABLE', message: 'Account sign-in is temporarily unavailable. Please try again.' }, {
      status: 503, headers: PRIVATE_HEADERS,
    });
  }
}

export const GET = handle;
export const POST = handle;
