import { env } from 'cloudflare:workers';
import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { assetResponse, bucket, database, getAsset, getLibrary } from '@/lib/server/storage';
import { idSchema, referencedAssets } from '@/lib/server/validation';
import type { AppState } from '@/lib/types';
import { cleanupAssetTransfers, queueUnusedAssetRemoval } from '@/lib/server/asset-transfers';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handled(async()=>{
  const user=await authenticated(request);const {id}=await context.params;if(!idSchema.safeParse(id).success)throw new HttpError(404,'File not found.');
  const asset=await getAsset(id,user.userId);if(!asset)throw new HttpError(404,'File not found.');
  const object=await bucket().get(asset.object_key);if(!object)throw new HttpError(404,'File not found.');
  return assetResponse(object,asset);
});}
export async function DELETE(request:Request,context:Context){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const {id}=await context.params;
  if(!idSchema.safeParse(id).success)throw new HttpError(404,'File not found.');
  const asset=await getAsset(id,user.userId);if(!asset)throw new HttpError(404,'File not found.');
  const library=await getLibrary(user.userId);
  if(library && referencedAssets(JSON.parse(library.state) as AppState).some(ref=>ref.id===id))throw new HttpError(409,'Remove this file from your library or shelves before deleting it.');
  // Published representations have independent image lifetimes. Capture the
  // cleanup obligation and revoke private access in one atomic D1 batch, with
  // public-reference checks and a private-library version precondition.
  const deleted=await queueUnusedAssetRemoval(env,user.userId,id,library?.version??null);
  if(!deleted)throw new HttpError(409,'Your library or shared content changed. Update or unpublish the content using this file, then try again.');
  await cleanupAssetTransfers(env,{ownerId:user.userId,limit:2});
  const pending=await database().prepare('SELECT 1 FROM asset_transfers WHERE id = ? AND owner_id = ?').bind(id,user.userId).first();
  return json({deleted:true,cleanupPending:!!pending});
});}
