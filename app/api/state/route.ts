import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { checkAssetReferences, database, getLibrary } from '@/lib/server/storage';
import { saveSchema } from '@/lib/server/validation';

export const dynamic='force-dynamic';
export async function GET(){return handled(async()=>{
  const user=await authenticated();const row=await getLibrary(user.userId);
  return json({state:row?JSON.parse(row.state):null,version:row?.version??0,user:{name:user.fullName??'Reader'}});
});}
export async function PUT(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated();const parsed=saveSchema.safeParse(await readJson(request));
  if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message??'Invalid library data.');
  const {state,version}=parsed.data;await checkAssetReferences(state,user.userId);
  const serialized=JSON.stringify(state);if(new TextEncoder().encode(serialized).byteLength>2*1024*1024)throw new HttpError(413,'Your library backup is too large.');
  const now=new Date().toISOString();const db=database();
  const result=version===0
    ?await db.prepare('INSERT INTO libraries (owner_id,state,version,updated_at) VALUES (?,?,1,?) ON CONFLICT(owner_id) DO NOTHING').bind(user.userId,serialized,now).run()
    :await db.prepare('UPDATE libraries SET state = ?, version = version + 1, updated_at = ? WHERE owner_id = ? AND version = ?').bind(serialized,now,user.userId,version).run();
  if(!result.meta.changes)throw new HttpError(409,'Your library changed in another tab or device. Export your local changes, then reload to get the latest version.');
  // Removing a shelf also revokes its published snapshot. Library edits otherwise
  // stay private until the owner explicitly publishes an updated snapshot.
  const ids=new Set(state.shelves.map(s=>s.id));
  const publications=await db.prepare('SELECT id,shelf_id FROM publications WHERE owner_id = ?').bind(user.userId).all<{id:string;shelf_id:string}>();
  const removed=publications.results.filter(publication=>!ids.has(publication.shelf_id));
  if(removed.length)await db.batch(removed.map(publication=>db.prepare('DELETE FROM publications WHERE id = ? AND owner_id = ?').bind(publication.id,user.userId)));
  return json({version:version+1});
});}
