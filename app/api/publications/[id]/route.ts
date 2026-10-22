import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id}=await context.params;const row=await database().prepare('SELECT snapshot FROM publications WHERE id = ?').bind(id).first<{snapshot:string}>();
  if(!row)throw new HttpError(404,'This shelf is private or no longer shared.');return json(JSON.parse(row.snapshot));
});}
export async function DELETE(request:Request,context:Context){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const {id}=await context.params;
  const result=await database().prepare('DELETE FROM publications WHERE id = ? AND owner_id = ?').bind(id,user.userId).run();
  if(!result.meta.changes)throw new HttpError(404,'Shared shelf not found.');return json({deleted:true});
});}
