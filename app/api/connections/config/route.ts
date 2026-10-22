import { env } from 'cloudflare:workers';
import { authenticated, handled, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
/** A public OAuth application ID, never a provider token or client secret. */
export async function GET(request: Request) { return handled(async () => {
  await authenticated(request);
  const configured = (env as Cloudflare.Env).HARDCOVER_CLIENT_ID?.trim();
  const clientId = configured && /^[a-zA-Z0-9_-]{8,160}$/.test(configured) ? configured : undefined;
  return json({ hardcover: { available: !!clientId, ...(clientId ? { clientId } : {}) } });
}); }
