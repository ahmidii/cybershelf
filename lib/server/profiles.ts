import type { PublicProfile } from '../types';
import { database } from './storage';

export interface PublicProfileRow {
  id:string;owner_id:string;shelf_id:string;snapshot:string;image_ids:string;published_at:string;updated_at:string;
}
export function getOwnProfile(ownerId:string){
  return database().prepare('SELECT * FROM public_profiles WHERE owner_id = ?').bind(ownerId).first<PublicProfileRow>();
}
export function profileSummary(row:PublicProfileRow){
  const snapshot=JSON.parse(row.snapshot) as PublicProfile;
  return {id:row.id,shelfId:row.shelf_id,name:snapshot.name,bio:snapshot.bio,publishedAt:row.published_at,updatedAt:row.updated_at};
}
