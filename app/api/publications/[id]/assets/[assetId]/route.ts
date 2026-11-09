import { getCurrentUser } from '@/app/auth';
import { publicContentSql, viewerCanSee } from '@/lib/server/moderation';
import { handled, HttpError } from '@/lib/server/http';
import { assetResponse, bucket, database, getAsset } from '@/lib/server/storage';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string;assetId:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id,assetId}=await context.params;
  const row=await database().prepare(`SELECT owner_id,image_ids FROM publications p WHERE id = ? AND ${publicContentSql('shelf','p.id','p.owner_id')}`).bind(id).first<{owner_id:string;image_ids:string}>();
  if(!row || !await viewerCanSee((await getCurrentUser())?.userId,row.owner_id) || !(JSON.parse(row.image_ids) as string[]).includes(assetId))throw new HttpError(404,'Image not found.');
  const asset=await getAsset(assetId,row.owner_id);if(!asset || asset.kind!=='image')throw new HttpError(404,'Image not found.');
  const object=await bucket().get(asset.object_key);if(!object)throw new HttpError(404,'Image not found.');return assetResponse(object,asset,true);
});}
