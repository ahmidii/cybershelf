import type { AppState,Book } from '../types';
import { database } from './storage';
import { privateImageId } from './validation';

/** Only visible artwork owned by this reader can acquire a public URL. */
export async function verifiedShelfImages(state:AppState,shelfId:string,ownerId:string):Promise<Set<string>> {
  const shelf=state.shelves.find(candidate=>candidate.id===shelfId);
  if(!shelf)return new Set();
  const visible=shelf.items.filter(item=>item.slot!==null);
  const bookIds=new Set(visible.filter(item=>item.kind==='book').map(item=>item.bookId));
  const ids=new Set<string>();
  for(const book of state.books)if(bookIds.has(book.id)){
    for(const value of [book.coverUrl,book.spineUrl]){const image=privateImageId(value);if(image)ids.add(image);}
  }
  for(const item of visible)if(item.kind==='decor'){
    const image=item.assetId??privateImageId(item.imageUrl);if(image)ids.add(image);
  }
  const verified=new Set<string>(),all=[...ids],db=database();
  for(let offset=0;offset<all.length;offset+=80){
    const chunk=all.slice(offset,offset+80);
    const rows=await db.prepare(`SELECT id FROM assets WHERE owner_id = ? AND kind = 'image' AND id IN (${chunk.map(()=>'?').join(',')})`).bind(ownerId,...chunk).all<{id:string}>();
    for(const row of rows.results)verified.add(row.id);
  }
  return verified;
}

export async function verifiedBookImages(book:Book,ownerId:string):Promise<Set<string>>{
  const ids=[...new Set([book.coverUrl,book.spineUrl].map(value=>privateImageId(value)).filter((value):value is string=>!!value))];
  if(!ids.length)return new Set();
  const rows=await database().prepare(`SELECT id FROM assets WHERE owner_id = ? AND kind = 'image' AND id IN (${ids.map(()=>'?').join(',')})`).bind(ownerId,...ids).all<{id:string}>();
  return new Set(rows.results.map(row=>row.id));
}
