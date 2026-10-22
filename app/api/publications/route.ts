import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database, getLibrary, type PublicationRow } from '@/lib/server/storage';
import { idSchema, makePublication } from '@/lib/server/validation';
import { verifiedShelfImages } from '@/lib/server/publication-images';
import type { AppState } from '@/lib/types';

export const dynamic='force-dynamic';
export async function GET(request:Request){return handled(async()=>{
  const cursor=new URL(request.url).searchParams.get('cursor');
  let after:string|null=null;
  if(cursor){try{const parsed=JSON.parse(atob(cursor));if(Array.isArray(parsed)&&parsed.length===2&&typeof parsed[0]==='string'&&idSchema.safeParse(parsed[1]).success)after=JSON.stringify(parsed);}catch{ /* invalid cursor below */ }
    if(!after)throw new HttpError(400,'Invalid page cursor.');}
  const bound=after?JSON.parse(after) as [string,string]:null;
  const result=await (bound?database().prepare('SELECT p.*, r.id AS profile_id FROM publications p LEFT JOIN public_profiles r ON r.owner_id = p.owner_id WHERE p.updated_at < ? OR (p.updated_at = ? AND p.id < ?) ORDER BY p.updated_at DESC, p.id DESC LIMIT 25').bind(bound[0],bound[0],bound[1]):database().prepare('SELECT p.*, r.id AS profile_id FROM publications p LEFT JOIN public_profiles r ON r.owner_id = p.owner_id ORDER BY p.updated_at DESC, p.id DESC LIMIT 25')).all<PublicationRow&{profile_id:string|null}>();
  const rows=result.results.slice(0,24),last=rows[rows.length-1];
  return json({items:rows.map(row=>({...JSON.parse(row.snapshot),...(row.profile_id?{profileId:row.profile_id}:{})})),...(result.results.length>24&&last?{nextCursor:btoa(JSON.stringify([last.updated_at,last.id]))}:{})});
});}
export async function POST(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const body=await readJson(request,4096) as {shelfId?:unknown};
  const parsed=idSchema.safeParse(body?.shelfId);if(!parsed.success)throw new HttpError(400,'Choose a shelf to share.');
  const library=await getLibrary(user.userId);if(!library)throw new HttpError(404,'Save your shelf before sharing it.');
  const state=JSON.parse(library.state) as AppState;const shelf=state.shelves.find(s=>s.id===parsed.data);if(!shelf)throw new HttpError(404,'Shelf not found.');
  const db=database();let existing=await db.prepare('SELECT * FROM publications WHERE owner_id = ? AND shelf_id = ?').bind(user.userId,shelf.id).first<PublicationRow>();
  let id=existing?.id??'pub_'+crypto.randomUUID();const now=new Date().toISOString();
  const verified=await verifiedShelfImages(state,shelf.id,user.userId);
  let publication=makePublication(state,shelf.id,id,existing?.published_at??now,verified);
  if(!existing){
    const inserted=await db.prepare('INSERT INTO publications (id,owner_id,shelf_id,snapshot,image_ids,published_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?) ON CONFLICT(owner_id,shelf_id) DO NOTHING')
      .bind(id,user.userId,shelf.id,JSON.stringify(publication),JSON.stringify([...verified]),now,now,user.userId,library.version).run();
    if(inserted.meta.changes)return json({id,url:'/s/'+id},201);
    existing=await db.prepare('SELECT * FROM publications WHERE owner_id = ? AND shelf_id = ?').bind(user.userId,shelf.id).first<PublicationRow>();
    if(!existing)throw new HttpError(409,'Your Library changed while sharing. Save your changes and try again.');
    id=existing.id;publication=makePublication(state,shelf.id,id,existing.published_at,verified);
  }
  const updated=await db.prepare('UPDATE publications SET snapshot = ?, image_ids = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?)')
    .bind(JSON.stringify(publication),JSON.stringify([...verified]),now,id,user.userId,user.userId,library.version).run();
  if(!updated.meta.changes)throw new HttpError(409,'Your Library or published shelf changed. Save your changes and try again.');
  return json({id,url:'/s/'+id});
});}
