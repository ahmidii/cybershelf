import { z } from 'zod';
import type { AppState } from '@/lib/types';
import { readingBookKey } from '@/lib/reading';
import { authenticated,handled,HttpError,json,readJson,sameOrigin } from '@/lib/server/http';
import { database,getLibrary } from '@/lib/server/storage';
import { getOwnProfile } from '@/lib/server/profiles';
import { idSchema,makeReadingSnapshot } from '@/lib/server/validation';
import { verifiedBookImages } from '@/lib/server/publication-images';
import { getPublicReadingPost,readingPostDto,reserveReadingAction,type ReadingPostRow } from '@/lib/server/journal';

export const dynamic='force-dynamic';
const shareInput=z.object({bookId:idSchema,entryId:idSchema});
export async function GET(request:Request){return handled(async()=>{
  const user=await authenticated(request),db=database();
  const [profile,posts]=await Promise.all([
    getOwnProfile(user.userId),
    db.prepare('SELECT p.id,p.book_id,p.entry_id,p.published_at,r.id AS live_profile_id FROM reading_posts p LEFT JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id WHERE p.owner_id = ? ORDER BY p.published_at DESC,p.id DESC LIMIT 2000').bind(user.userId).all<{id:string;book_id:string;entry_id:string;published_at:string;live_profile_id:string|null}>(),
  ]);
  return json({posts:posts.results.map(row=>({id:row.id,bookId:row.book_id,entryId:row.entry_id,published:!!row.live_profile_id,publishedAt:row.published_at})),...(profile?{profileId:profile.id}:{})});
});}

export async function POST(request:Request){return handled(async()=>{
  sameOrigin(request);const user=await authenticated(request);
  const parsed=shareInput.safeParse(await readJson(request,4096));
  if(!parsed.success)throw new HttpError(400,'Choose a saved reading entry to share.');
  const library=await getLibrary(user.userId);
  if(!library)throw new HttpError(409,'Save your reading entry before sharing it.');
  const state=JSON.parse(library.state) as AppState;
  const book=state.books.find(candidate=>candidate.id===parsed.data.bookId),entry=book?.readingLog?.find(candidate=>candidate.id===parsed.data.entryId);
  if(!book||!entry)throw new HttpError(404,'This reading entry is not in your saved Library.');
  const profile=await getOwnProfile(user.userId);
  if(!profile)throw new HttpError(409,'Publish your profile before sharing a reading entry.');
  const imageIds=await verifiedBookImages(book,user.userId),db=database(),now=new Date().toISOString();
  let existing=await db.prepare('SELECT * FROM reading_posts WHERE owner_id = ? AND entry_id = ?').bind(user.userId,entry.id).first<ReadingPostRow>();
  let id=existing?.id??'entry_'+crypto.randomUUID();
  await reserveReadingAction(user.userId,'post');
  let snapshot=makeReadingSnapshot(book,entry,id,imageIds);
  if(!existing){
    const inserted=await db.prepare('INSERT INTO reading_posts (id,owner_id,profile_id,book_id,entry_id,snapshot,image_ids,published_at,updated_at,book_key,catalog_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM public_profiles WHERE id = ? AND owner_id = ?) AND (SELECT COUNT(*) FROM reading_posts WHERE owner_id = ?) < 2000 ON CONFLICT(owner_id,entry_id) DO NOTHING')
      .bind(id,user.userId,profile.id,book.id,entry.id,JSON.stringify(snapshot),JSON.stringify([...imageIds]),now,now,readingBookKey(book),book.catalogId??null,user.userId,library.version,profile.id,user.userId,user.userId).run();
    if(inserted.meta.changes){const row=await getPublicReadingPost(id);if(!row)throw new HttpError(409,'Your profile was made private while sharing.');return json({post:readingPostDto(row)},201);}
    existing=await db.prepare('SELECT * FROM reading_posts WHERE owner_id = ? AND entry_id = ?').bind(user.userId,entry.id).first<ReadingPostRow>();
    if(!existing)throw new HttpError(409,'Your Library or profile changed while sharing, or you have reached 2,000 shared entries. Review your saved entries and try again.');
    id=existing.id;snapshot=makeReadingSnapshot(book,entry,id,imageIds);
  }
  const publishedAt=existing.profile_id===profile.id?existing.published_at:now;
  const updated=await db.prepare('UPDATE reading_posts SET profile_id = ?, book_id = ?, snapshot = ?, image_ids = ?, published_at = ?, updated_at = ?, book_key = ?, catalog_id = ? WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM libraries WHERE owner_id = ? AND version = ?) AND EXISTS (SELECT 1 FROM public_profiles WHERE id = ? AND owner_id = ?)')
    .bind(profile.id,book.id,JSON.stringify(snapshot),JSON.stringify([...imageIds]),publishedAt,now,readingBookKey(book),book.catalogId??null,id,user.userId,user.userId,library.version,profile.id,user.userId).run();
  if(!updated.meta.changes)throw new HttpError(409,'Your Library or profile changed while sharing. Save your changes and try again.');
  const row=await getPublicReadingPost(id);if(!row)throw new HttpError(409,'Your profile was made private while sharing.');
  return json({post:readingPostDto(row)});
});}
