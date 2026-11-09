import { env } from 'cloudflare:workers';
import { claimAccountUsername } from '@/lib/server/username-accounts';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => claimAccountUsername(request, env);
