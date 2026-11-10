import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/app/auth';
import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { contributionSchema, contributeSharedAsset, listSharedAssets, sharedAssetError } from '@/lib/server/community-assets';
import { limitUploadAttempts } from '@/lib/server/asset-transfers';
import { withUploadBodySlot } from '@/lib/server/upload-body';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handled(async () => {
  const params = new URL(request.url).searchParams;
  const user = params.get('mine') === 'true' ? await authenticated(request) : await getCurrentUser();
  return json(await listSharedAssets(params, user?.userId));
}); }
export async function POST(request: Request) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request);
  const parsed = contributionSchema.safeParse(await readJson(request, 16384));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Check the contribution details and permission statement.');
  try {
    await limitUploadAttempts(env, request, user.userId);
    return await withUploadBodySlot(request, async () => json({ asset: await contributeSharedAsset(user.userId, parsed.data) }, 201));
  } catch (error) { sharedAssetError(error); }
}); }
