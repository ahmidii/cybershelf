import { z } from 'zod';
import type { AppState } from '@/lib/types';
import { authenticated,handled,HttpError,json,readJson,sameOrigin } from '@/lib/server/http';
import { database,getLibrary } from '@/lib/server/storage';
import { getOwnProfile } from '@/lib/server/profiles';
import { getPublicReadingPost,readingPostDto,reserveReadingAction } from '@/lib/server/journal';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
const commentInput=z.object({body:z.string().trim().min(1).max(4000),progress:z.number().min(0).max(100)});
export async function POST(request:Request,context:Context){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const {id}=await context.params;
  const parsed=commentInput.safeParse(await readJson(request,32768));
  if(!parsed.success)throw new HttpError(400,'Write a reply of up to 4,000 characters and choose a reading progress between 0 and 100%.');
  const post=await getPublicReadingPost(id);
  if(!post)throw new HttpError(404,'This reading entry is private or no longer shared.');
  const snapshot=readingPostDto(post);
  if(parsed.data.progress<snapshot.entry.progress)throw new HttpError(400,`Mark this reply at ${snapshot.entry.progress}% or later so readers can avoid spoilers.`);
  const [library,profile]=await Promise.all([getLibrary(user.userId),getOwnProfile(user.userId)]);
  const state=library?JSON.parse(library.state) as AppState:null;
  const name=(state?.profile.name||user.fullName||'Reader').slice(0,80),now=new Date().toISOString(),commentId='reply_'+crypto.randomUUID();
  await reserveReadingAction(user.userId,'comment');
  const result=await database().prepare("INSERT INTO reading_comments (id,post_id,owner_id,profile_id,name,body,progress,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id WHERE p.id = ? AND p.updated_at = ? AND CAST(json_extract(p.snapshot, '$.entry.progress') AS REAL) <= ?) AND (? IS NULL OR EXISTS (SELECT 1 FROM public_profiles WHERE id = ? AND owner_id = ?)) AND (SELECT COUNT(*) FROM reading_comments WHERE post_id = ?) < 100")
    .bind(commentId,id,user.userId,profile?.id??null,name,parsed.data.body,parsed.data.progress,now,id,post.updated_at,parsed.data.progress,profile?.id??null,profile?.id??null,user.userId,id).run();
  if(!result.meta.changes)throw new HttpError(409,'This conversation changed or has reached 100 replies. Reload before replying.');
  return json({comment:{id:commentId,name,body:parsed.data.body,progress:parsed.data.progress,createdAt:now,...(profile?{profileId:profile.id}:{}),canDelete:true}},201);
});}
