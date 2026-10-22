import type { PublicProfile,ReadingComment,ReadingPost } from '../types';
import { database } from './storage';
import { HttpError } from './http';

export interface ReadingPostRow {
  id:string;owner_id:string;profile_id:string;book_id:string;entry_id:string;snapshot:string;image_ids:string;published_at:string;updated_at:string;
}
export interface JoinedReadingPost extends ReadingPostRow {profile_snapshot:string;comment_count:number;}
export const visibleCommentSql="(c.profile_id IS NULL OR EXISTS (SELECT 1 FROM public_profiles cp WHERE cp.id = c.profile_id AND cp.owner_id = c.owner_id))";
export const publicReadingPostSelect=`SELECT p.*, r.snapshot AS profile_snapshot, (SELECT COUNT(*) FROM reading_comments c WHERE c.post_id = p.id AND ${visibleCommentSql}) AS comment_count FROM reading_posts p JOIN public_profiles r ON r.id = p.profile_id AND r.owner_id = p.owner_id`;

export function getPublicReadingPost(id:string){return database().prepare(publicReadingPostSelect+' WHERE p.id = ?').bind(id).first<JoinedReadingPost>();}
export function readingPostDto(row:JoinedReadingPost):ReadingPost{
  const snapshot=JSON.parse(row.snapshot) as Pick<ReadingPost,'book'|'entry'>;
  const profile=JSON.parse(row.profile_snapshot) as PublicProfile;
  return {id:row.id,profileId:row.profile_id,name:profile.name,book:snapshot.book,entry:snapshot.entry,publishedAt:row.published_at,commentCount:row.comment_count};
}
export async function readingComments(post:ReadingPostRow,viewerId?:string):Promise<ReadingComment[]>{
  const parentProgress=(JSON.parse(post.snapshot) as Pick<ReadingPost,'entry'>).entry.progress;
  const rows=await database().prepare(`SELECT c.id,c.owner_id,c.profile_id,c.name,c.body,c.progress,c.created_at FROM reading_comments c WHERE c.post_id = ? AND ${visibleCommentSql} ORDER BY c.created_at ASC,c.id ASC LIMIT 100`).bind(post.id).all<{id:string;owner_id:string;profile_id:string|null;name:string;body:string;progress:number;created_at:string}>();
  // An explicitly reshared entry may move to a later reading point. Replies
  // must never reveal their conversation context before that new parent point.
  return rows.results.map(row=>({id:row.id,name:row.name,body:row.body,progress:Math.max(row.progress,parentProgress),createdAt:row.created_at,...(row.profile_id?{profileId:row.profile_id}:{}),canDelete:!!viewerId&&(viewerId===row.owner_id||viewerId===post.owner_id)}));
}

/** A retained event counter prevents deletion from resetting posting limits. */
export async function reserveReadingAction(ownerId:string,kind:'post'|'comment'|'catalog'|'rating'|'read'){
  const now=Date.now(),timestamp=new Date(now).toISOString(),minute=new Date(now-60_000).toISOString(),day=new Date(now-86_400_000).toISOString();
  const db=database(),minuteLimit=kind==='comment'?10:20,dayLimit=kind==='comment'?200:500;
  const results=await db.batch([
    db.prepare('DELETE FROM reading_events WHERE owner_id = ? AND kind = ? AND created_at < ?').bind(ownerId,kind,day),
    db.prepare('INSERT INTO reading_events (id,owner_id,kind,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM reading_events WHERE owner_id = ? AND kind = ? AND created_at >= ?) < ? AND (SELECT COUNT(*) FROM reading_events WHERE owner_id = ? AND kind = ?) < ?')
      .bind(crypto.randomUUID(),ownerId,kind,timestamp,ownerId,kind,minute,minuteLimit,ownerId,kind,dayLimit),
  ]);
  if(!results[1].meta.changes)throw new HttpError(429,'You have shared a lot in a short time. Please wait before posting again.');
}
