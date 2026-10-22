import { handled,HttpError,json } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { idSchema } from '@/lib/server/validation';
import { publicReadingPostSelect,readingPostDto,type JoinedReadingPost } from '@/lib/server/journal';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return handled(async()=>{
  const {id}=await context.params,db=database();
  if(!idSchema.safeParse(id).success||!await db.prepare('SELECT id FROM public_profiles WHERE id = ?').bind(id).first())throw new HttpError(404,'This profile is private or no longer shared.');
  const cursor=new URL(request.url).searchParams.get('cursor');let after:[string,string]|null=null;
  if(cursor){try{const value=JSON.parse(atob(cursor));if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isFinite(Date.parse(value[0]))&&idSchema.safeParse(value[1]).success)after=value as [string,string];}catch{/* Invalid cursor below. */}if(!after)throw new HttpError(400,'Invalid journal page cursor.');}
  const statement=after?db.prepare(publicReadingPostSelect+' WHERE p.profile_id = ? AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?)) ORDER BY p.published_at DESC,p.id DESC LIMIT 101').bind(id,after[0],after[0],after[1]):db.prepare(publicReadingPostSelect+' WHERE p.profile_id = ? ORDER BY p.published_at DESC,p.id DESC LIMIT 101').bind(id);
  const result=await statement.all<JoinedReadingPost>(),rows=result.results.slice(0,100),last=rows.at(-1);
  return json({posts:rows.map(readingPostDto),...(result.results.length>100&&last?{nextCursor:btoa(JSON.stringify([last.published_at,last.id]))}:{})});
});}
