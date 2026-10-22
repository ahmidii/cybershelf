import { authenticated, boundedStream, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { bucket, database, type AssetRow } from '@/lib/server/storage';
import { detectedFileType } from '@/lib/server/file-types';

export const dynamic='force-dynamic';
export async function GET(){return handled(async()=>{
  const user=await authenticated();const result=await database().prepare('SELECT * FROM assets WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1000').bind(user.userId).all<AssetRow>();
  return json({assets:result.results.map(a=>({id:a.id,filename:a.filename,mime:a.mime,size:a.size,url:'/api/assets/'+a.id})),usedBytes:result.results.reduce((total,a)=>total+a.size,0),limitBytes:500*1024*1024});
});}
export async function POST(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated();
  const contentType=request.headers.get('content-type')??'';
  if(!contentType.startsWith('multipart/form-data'))throw new HttpError(415,'Choose a file to upload.');
  const body=boundedStream(request,26*1024*1024);
  let form:FormData;
  try{form=await new Response(body,{headers:{'content-type':contentType}}).formData();}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'The upload could not be read.');}
  const file=form.get('file');const kind=form.get('kind');
  if(!(file instanceof File) || !['book','image'].includes(String(kind)))throw new HttpError(400,'Choose a book or an image file.');
  const limit=kind==='book'?25*1024*1024:4*1024*1024;
  if(file.size===0 || file.size>limit)throw new HttpError(413,kind==='book'?'Books can be up to 25 MB.':'Images can be up to 4 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());const detected=detectedFileType(bytes);
  if(!detected || detected.kind!==kind)throw new HttpError(415,kind==='book'?'Use a valid EPUB or PDF file.':'Use a PNG, JPEG, or WebP image.');
  const db=database();const usage=await db.prepare('SELECT COALESCE(SUM(size),0) AS total, COUNT(*) AS count FROM assets WHERE owner_id = ?').bind(user.userId).first<{total:number;count:number}>();
  if((usage?.total??0)+file.size>500*1024*1024 || (usage?.count??0)>=1000)throw new HttpError(413,'Your account has reached the first-release storage limit (500 MB or 1,000 files).');
  const id='as_'+crypto.randomUUID(),objectKey='private/'+id;
  const filename=file.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,220)||'book';
  const cleanFilename=filename.toLowerCase().endsWith('.'+detected.extension)||(detected.extension==='jpg'&&filename.toLowerCase().endsWith('.jpeg'))?filename:filename+'.'+detected.extension;
  await bucket().put(objectKey,bytes,{httpMetadata:{contentType:detected.mime}});
  try{await db.prepare('INSERT INTO assets (id,owner_id,kind,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,user.userId,kind,objectKey,cleanFilename,detected.mime,file.size,new Date().toISOString()).run();}
  catch(error){await bucket().delete(objectKey);throw error;}
  return json({id,filename:cleanFilename,mime:detected.mime,size:file.size,url:'/api/assets/'+id},201);
});}
