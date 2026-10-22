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
  // Published profiles and reading entries own independent image snapshots.
  // Keep the liveness checks inside the delete, including the exact captured
  // profile identity for journals; an old, hidden entry must not pin an image.
  const deleted=await database().prepare(`DELETE FROM assets WHERE id = ? AND owner_id = ?
    AND NOT EXISTS (SELECT 1 FROM publications p, json_each(p.image_ids) image WHERE p.owner_id = assets.owner_id AND image.value = assets.id)
    AND NOT EXISTS (SELECT 1 FROM public_profiles p, json_each(p.image_ids) image WHERE p.owner_id = assets.owner_id AND image.value = assets.id)
    AND NOT EXISTS (SELECT 1 FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id, json_each(p.image_ids) image WHERE p.owner_id = assets.owner_id AND image.value = assets.id)`)
    .bind(id,user.userId).run();
  if(!deleted.meta.changes)throw new HttpError(409,'Update or unpublish the shared shelves, profile, or reading entries that use this image before deleting it.');
  await bucket().delete(asset.object_key);return json({deleted:true});
});}
