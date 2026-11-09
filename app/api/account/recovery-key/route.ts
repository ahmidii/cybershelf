import { env } from 'cloudflare:workers';
import { replaceRecoveryKey } from '@/lib/server/username-accounts';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => replaceRecoveryKey(request, env);
