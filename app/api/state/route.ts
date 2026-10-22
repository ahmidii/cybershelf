import { authenticated, handled, HttpError, json, readJson, sameOrigin } from '@/lib/server/http';
import { checkAssetReferences, database, getLibrary } from '@/lib/server/storage';
import { saveSchema } from '@/lib/server/validation';

export const dynamic='force-dynamic';
export async function GET(request:Request){return handled(async()=>{
  const user=await authenticated(request);const row=await getLibrary(user.userId);
  return json({state:row?JSON.parse(row.state):null,version:row?.version??0,user:{id:user.userId,name:user.fullName??'Reader'}});
});}
export async function PUT(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);const parsed=saveSchema.safeParse(await readJson(request));
  if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message??'Invalid library data.');
  const {state,version}=parsed.data;await checkAssetReferences(state,user.userId);
  const serialized=JSON.stringify(state);if(new TextEncoder().encode(serialized).byteLength>2*1024*1024)throw new HttpError(413,'Your library backup is too large.');
  const now=new Date().toISOString();const db=database();
  const save=version===0
    ?db.prepare('INSERT INTO libraries (owner_id,state,version,updated_at) VALUES (?,?,1,?) ON CONFLICT(owner_id) DO NOTHING').bind(user.userId,serialized,now)
    :db.prepare('UPDATE libraries SET state = ?, version = version + 1, updated_at = ? WHERE owner_id = ? AND version = ?').bind(serialized,now,user.userId,version);
  // Save and revoke removed objects in one transaction. Each cleanup reads the
  // actual saved state, so a stale save cannot remove a newer tab's publication.
  const results=await db.batch([
    save,
    db.prepare("DELETE FROM publications WHERE owner_id = ? AND shelf_id NOT IN (SELECT json_extract(s.value, '$.id') FROM libraries l, json_each(l.state, '$.shelves') s WHERE l.owner_id = ?)").bind(user.userId,user.userId),
    db.prepare("DELETE FROM public_profiles WHERE owner_id = ? AND shelf_id NOT IN (SELECT json_extract(s.value, '$.id') FROM libraries l, json_each(l.state, '$.shelves') s WHERE l.owner_id = ?)").bind(user.userId,user.userId),
    db.prepare("DELETE FROM reading_posts WHERE owner_id = ? AND (book_id,entry_id) NOT IN (SELECT json_extract(b.value, '$.id'),json_extract(e.value, '$.id') FROM libraries l, json_each(l.state, '$.books') b, json_each(b.value, '$.readingLog') e WHERE l.owner_id = ?)").bind(user.userId,user.userId),
  ]);
  if(!results[0].meta.changes)throw new HttpError(409,'Your library changed in another tab or device. Export your local changes, then reload to get the latest version.');
  return json({version:version+1});
});}
