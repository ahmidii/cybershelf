import { handled,HttpError } from '@/lib/server/http';
import { assetResponse,bucket,getAsset } from '@/lib/server/storage';
import { getPublicReadingPost } from '@/lib/server/journal';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string;assetId:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id,assetId}=await context.params,row=await getPublicReadingPost(id);
  if(!row||!(JSON.parse(row.image_ids) as string[]).includes(assetId))throw new HttpError(404,'Image not found.');
  const asset=await getAsset(assetId,row.owner_id);if(!asset||asset.kind!=='image')throw new HttpError(404,'Image not found.');
  const object=await bucket().get(asset.object_key);if(!object)throw new HttpError(404,'Image not found.');
  return assetResponse(object,asset,true);
});}
