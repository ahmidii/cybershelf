import { getCurrentUser } from '@/app/auth';
import { authenticated,handled,HttpError,json,sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { getPublicReadingPost,readingComments,readingPostDto } from '@/lib/server/journal';
import { idSchema } from '@/lib/server/validation';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id}=await context.params;
  if(!idSchema.safeParse(id).success)throw new HttpError(404,'This reading entry is private or no longer shared.');
  const row=await getPublicReadingPost(id);
  if(!row)throw new HttpError(404,'This reading entry is private or no longer shared.');
  const viewer=await getCurrentUser();
  const comments=await readingComments(row,viewer?.userId);
  return json({post:readingPostDto(row),comments,viewer:{accountId:viewer?.userId??null,canModerate:viewer?.userId===row.owner_id}});
});}
export async function DELETE(request:Request,context:Context){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const {id}=await context.params;
  const result=await database().prepare('DELETE FROM reading_posts WHERE id = ? AND owner_id = ?').bind(id,user.userId).run();
  if(!result.meta.changes)throw new HttpError(404,'Shared reading entry not found.');
  return json({deleted:true});
});}
