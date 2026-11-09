import { getCurrentUser } from '@/app/auth';
import { publicContentSql, viewerCanSee } from '@/lib/server/moderation';
import { handled,HttpError,json } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { idSchema } from '@/lib/server/validation';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id}=await context.params;
  if(!idSchema.safeParse(id).success)throw new HttpError(404,'This profile is private or no longer shared.');
  const row=await database().prepare(`SELECT snapshot,owner_id FROM public_profiles p WHERE id = ? AND ${publicContentSql('profile','p.id','p.owner_id')}`).bind(id).first<{snapshot:string;owner_id:string}>();
  if(!row||!await viewerCanSee((await getCurrentUser())?.userId,row.owner_id))throw new HttpError(404,'This profile is private or no longer shared.');
  return json(JSON.parse(row.snapshot));
});}
