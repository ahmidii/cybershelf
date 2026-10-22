import { env } from 'cloudflare:workers';
import { AuthConfigurationError, createAuth } from '../../../../lib/server/auth';
import { ACCOUNT_ID_HEADER } from '../../../../lib/auth-contract';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  try {
    const auth = createAuth(env);
    if (request.method === 'POST' && new URL(request.url).pathname.replace(/\/+$/, '') === '/api/auth/sign-out') {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session && request.headers.get(ACCOUNT_ID_HEADER) !== session.user.id) {
        return Response.json({ code: 'ACCOUNT_CHANGED', message: 'Your signed-in account changed. Reload before signing out.' }, {
          status: 409, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        });
      }
    }
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return Response.json({ code: 'AUTH_NOT_CONFIGURED', message: 'Account sign-in is not available yet. Please try again later.' }, {
        status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    // Do not include queries, credentials, or session cookies in error output.
    console.error('cybershelf authentication request failed');
    return Response.json({ code: 'AUTH_UNAVAILABLE', message: 'Account sign-in is temporarily unavailable. Please try again.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
}

export const GET = handle;
export const POST = handle;
