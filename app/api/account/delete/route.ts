import { env } from 'cloudflare:workers';
import { deleteAccount } from '@/lib/server/account-deletion';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => deleteAccount(request, env);
