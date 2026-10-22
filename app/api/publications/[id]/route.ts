import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id}=await context.params;const row=await database().prepare('SELECT p.snapshot, r.id AS profile_id FROM publications p LEFT JOIN public_profiles r ON r.owner_id = p.owner_id WHERE p.id = ?').bind(id).first<{snapshot:string;profile_id:string|null}>();
  if(!row)throw new HttpError(404,'This shelf is private or no longer shared.');return json({...JSON.parse(row.snapshot),...(row.profile_id?{profileId:row.profile_id}:{})});
});}
export async function DELETE(request:Request,context:Context){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const {id}=await context.params;
  const db=database();
  const results=await db.batch([
    db.prepare('DELETE FROM public_profiles WHERE owner_id = ? AND shelf_id IN (SELECT shelf_id FROM publications WHERE id = ? AND owner_id = ?)').bind(user.userId,id,user.userId),
    db.prepare('DELETE FROM publications WHERE id = ? AND owner_id = ?').bind(id,user.userId),
  ]);
  const result=results[1];
  if(!result.meta.changes)throw new HttpError(404,'Shared shelf not found.');return json({deleted:true});
});}
