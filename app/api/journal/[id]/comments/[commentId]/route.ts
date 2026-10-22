import { authenticated,handled,HttpError,json,sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string;commentId:string}>};
export async function DELETE(request:Request,context:Context){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const {id,commentId}=await context.params;
  const result=await database().prepare('DELETE FROM reading_comments WHERE id = ? AND post_id = ? AND (owner_id = ? OR EXISTS (SELECT 1 FROM reading_posts p WHERE p.id = reading_comments.post_id AND p.owner_id = ?))').bind(commentId,id,user.userId,user.userId).run();
  if(!result.meta.changes)throw new HttpError(404,'This reply was not found, or you cannot remove it.');
  return json({deleted:true});
});}
