import { getCurrentUser } from '@/app/auth';
import { handled } from '@/lib/server/http';
import { sharedAssetImageResponse } from '@/lib/server/community-assets';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handled(async () => {
  const user = await getCurrentUser(), { id } = await context.params;
  return sharedAssetImageResponse(id, request, user?.userId);
}); }
