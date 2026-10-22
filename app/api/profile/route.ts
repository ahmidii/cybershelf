import { z } from 'zod';
import { authenticated,handled,HttpError,json,readJson,sameOrigin } from '@/lib/server/http';
import { database,getLibrary } from '@/lib/server/storage';
import { getOwnProfile,profileSummary } from '@/lib/server/profiles';
import { idSchema,makePublicProfile } from '@/lib/server/validation';
import { verifiedShelfImages } from '@/lib/server/publication-images';
import type { AppState } from '@/lib/types';

export const dynamic='force-dynamic';
const publishInput=z.object({shelfId:idSchema,name:z.string().min(1).max(80),bio:z.string().max(1000),shelfUpdatedAt:z.string().max(40)});

export async function GET(request:Request){return handled(async()=>{
  const user=await authenticated(request),row=await getOwnProfile(user.userId);
  return json({profile:row?profileSummary(row):null,...(row?{url:'/u/'+row.id}:{})});
});}

export async function POST(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);
  const input=publishInput.safeParse(await readJson(request,4096));
  if(!input.success)throw new HttpError(400,'Choose a shelf and save your profile before publishing.');
  const library=await getLibrary(user.userId);
  if(!library)throw new HttpError(409,'Save your shelf before publishing your profile.');
  const state=JSON.parse(library.state) as AppState;
  const shelf=state.shelves.find(candidate=>candidate.id===input.data.shelfId);
  if(!shelf||state.profile.featuredShelfId!==shelf.id)throw new HttpError(409,'Your featured shelf changed. Reload your profile before publishing.');
  if(state.profile.name!==input.data.name||state.profile.bio!==input.data.bio||shelf.updatedAt!==input.data.shelfUpdatedAt)
    throw new HttpError(409,'Your profile changed in another tab. Review the latest version before publishing.');
  const imageIds=await verifiedShelfImages(state,shelf.id,user.userId),db=database();
  const now=new Date().toISOString();let row=await getOwnProfile(user.userId);
  let id=row?.id??'reader_'+crypto.randomUUID();
  let snapshot=makePublicProfile(state,id,row?.published_at??now,now,imageIds);
  if(!row){
    const inserted=await db.prepare('INSERT INTO public_profiles (id,owner_id,shelf_id,snapshot,image_ids,published_at,updated_at) SELECT ?,?,?,?,?,?,? FROM libraries WHERE owner_id = ? AND version = ? ON CONFLICT(owner_id) DO NOTHING')
      .bind(id,user.userId,shelf.id,JSON.stringify(snapshot),JSON.stringify([...imageIds]),now,now,user.userId,library.version).run();
    if(inserted.meta.changes)return json({profile:{id,shelfId:shelf.id,name:snapshot.name,bio:snapshot.bio,publishedAt:now,updatedAt:now},url:'/u/'+id},201);
    row=await getOwnProfile(user.userId);
    if(!row)throw new HttpError(409,'Your library changed while publishing. Save your changes and try again.');
    id=row.id;snapshot=makePublicProfile(state,id,row.published_at,now,imageIds);
  }
  const updated=await db.prepare('UPDATE public_profiles SET shelf_id = ?, snapshot = ?, image_ids = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?)')
    .bind(shelf.id,JSON.stringify(snapshot),JSON.stringify([...imageIds]),now,id,user.userId,user.userId,library.version).run();
  if(!updated.meta.changes)throw new HttpError(409,'Your library or published profile changed. Save your changes and try again.');
  return json({profile:{id,shelfId:shelf.id,name:snapshot.name,bio:snapshot.bio,publishedAt:snapshot.publishedAt,updatedAt:now},url:'/u/'+id});
});}

export async function DELETE(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);
  await database().prepare('DELETE FROM public_profiles WHERE owner_id = ?').bind(user.userId).run();
  return json({deleted:true});
});}
