import { env } from 'cloudflare:workers';
import { recoverUsernameAccount } from '@/lib/server/username-accounts';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => recoverUsernameAccount(request, env);
