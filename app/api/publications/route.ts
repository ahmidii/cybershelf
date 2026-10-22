import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { database, getLibrary, type PublicationRow } from '@/lib/server/storage';
import { idSchema, makePublication, privateImageId } from '@/lib/server/validation';
import type { AppState } from '@/lib/types';

export const dynamic='force-dynamic';
export async function GET(request:Request){return handled(async()=>{
  const cursor=new URL(request.url).searchParams.get('cursor');
  let after:string|null=null;
  if(cursor){try{const parsed=JSON.parse(atob(cursor));if(Array.isArray(parsed)&&parsed.length===2&&typeof parsed[0]==='string'&&idSchema.safeParse(parsed[1]).success)after=JSON.stringify(parsed);}catch{ /* invalid cursor below */ }
    if(!after)throw new HttpError(400,'Invalid page cursor.');}
  const bound=after?JSON.parse(after) as [string,string]:null;
  const result=await (bound?database().prepare('SELECT * FROM publications WHERE updated_at < ? OR (updated_at = ? AND id < ?) ORDER BY updated_at DESC, id DESC LIMIT 25').bind(bound[0],bound[0],bound[1]):database().prepare('SELECT * FROM publications ORDER BY updated_at DESC, id DESC LIMIT 25')).all<PublicationRow>();
  const rows=result.results.slice(0,24),last=rows[rows.length-1];
  return json({items:rows.map(row=>JSON.parse(row.snapshot)),...(result.results.length>24&&last?{nextCursor:btoa(JSON.stringify([last.updated_at,last.id]))}:{})});
});}
export async function POST(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const body=await readJson(request,4096) as {shelfId?:unknown};
  const parsed=idSchema.safeParse(body?.shelfId);if(!parsed.success)throw new HttpError(400,'Choose a shelf to share.');
  const library=await getLibrary(user.userId);if(!library)throw new HttpError(404,'Save your shelf before sharing it.');
  const state=JSON.parse(library.state) as AppState;const shelf=state.shelves.find(s=>s.id===parsed.data);if(!shelf)throw new HttpError(404,'Shelf not found.');
  const db=database();const existing=await db.prepare('SELECT * FROM publications WHERE owner_id = ? AND shelf_id = ?').bind(user.userId,shelf.id).first<PublicationRow>();
  let id=existing?.id??'pub_'+crypto.randomUUID();const now=new Date().toISOString();
  const imageIds=new Set<string>();const visible=shelf.items.filter(i=>i.slot!==null),bookIds=new Set(visible.map(i=>i.bookId));
  for(const book of state.books)if(bookIds.has(book.id)){const cover=privateImageId(book.coverUrl);if(cover)imageIds.add(cover);}
  for(const item of visible)if(item.kind==='decor'){const image=item.assetId??privateImageId(item.imageUrl);if(image)imageIds.add(image);}
  const verified=new Set<string>();
  for(const assetId of imageIds){const asset=await db.prepare('SELECT id FROM assets WHERE id = ? AND owner_id = ? AND kind = ?').bind(assetId,user.userId,'image').first<{id:string}>();if(asset)verified.add(asset.id);}
  let publication=makePublication(state,shelf.id,id,now,verified);
  const inserted=await db.prepare('INSERT INTO publications (id,owner_id,shelf_id,snapshot,image_ids,published_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,shelf_id) DO NOTHING').bind(id,user.userId,shelf.id,JSON.stringify(publication),JSON.stringify([...verified]),now,now).run();
  if(!inserted.meta.changes){
    const winner=await db.prepare('SELECT id FROM publications WHERE owner_id = ? AND shelf_id = ?').bind(user.userId,shelf.id).first<{id:string}>();
    if(!winner)throw new HttpError(409,'This shelf was unpublished in another tab. Please try again.');
    id=winner.id;publication=makePublication(state,shelf.id,id,now,verified);
    await db.prepare('UPDATE publications SET snapshot = ?, image_ids = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(JSON.stringify(publication),JSON.stringify([...verified]),now,id,user.userId).run();
  }
  return json({id,url:'/s/'+id},existing?200:201);
});}
