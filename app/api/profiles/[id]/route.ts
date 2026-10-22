import { handled,HttpError,json } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { idSchema } from '@/lib/server/validation';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return handled(async()=>{
  const {id}=await context.params;
  if(!idSchema.safeParse(id).success)throw new HttpError(404,'This profile is private or no longer shared.');
  const row=await database().prepare('SELECT snapshot FROM public_profiles WHERE id = ?').bind(id).first<{snapshot:string}>();
  if(!row)throw new HttpError(404,'This profile is private or no longer shared.');
  return json(JSON.parse(row.snapshot));
});}
