import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { assetResponse, bucket, database, getAsset, getLibrary } from '@/lib/server/storage';
import { idSchema, referencedAssets } from '@/lib/server/validation';
import type { AppState } from '@/lib/types';

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
  const asset=await getAsset(id,user.userId);if(!asset)throw new HttpError(404,'File not found.');
  const library=await getLibrary(user.userId);
  if(library && referencedAssets(JSON.parse(library.state) as AppState).some(ref=>ref.id===id))throw new HttpError(409,'Remove this file from your library or shelves before deleting it.');
  const published=await database().prepare('SELECT image_ids FROM publications WHERE owner_id = ?').bind(user.userId).all<{image_ids:string}>();
  if(published.results.some(p=>JSON.parse(p.image_ids).includes(id)))throw new HttpError(409,'Unpublish or update shelves that use this image before deleting it.');
  await database().prepare('DELETE FROM assets WHERE id = ? AND owner_id = ?').bind(id,user.userId).run();
  await bucket().delete(asset.object_key);return json({deleted:true});
});}
