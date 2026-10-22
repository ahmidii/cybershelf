import { handled, json } from '@/lib/server/http';
import type { SearchBook } from '@/lib/types';
import { openLibraryJSON } from '@/lib/server/book-catalog';

export const dynamic='force-dynamic';
const recent=new Map<string,{expires:number;books:SearchBook[]}>();
const inFlight=new Map<string,Promise<SearchBook[]>>();
export async function GET(request:Request){return handled(async()=>{
  const query=(new URL(request.url).searchParams.get('q')??'').trim().slice(0,200);
  if(query.length<2)return json({books:[]});
  const key=query.toLocaleLowerCase();const cached=recent.get(key);if(cached&&cached.expires>Date.now())return json({books:cached.books});
  let promise=inFlight.get(key);
  if(!promise){
    promise=lookup(query);inFlight.set(key,promise);
  }
  try{const books=await promise;return json({books});}finally{inFlight.delete(key);}
});}
async function lookup(query:string):Promise<SearchBook[]>{
  const url=new URL('https://openlibrary.org/search.json');url.searchParams.set('q',query);url.searchParams.set('limit','12');url.searchParams.set('fields','key,title,author_name,cover_i,isbn,number_of_pages_median');
  const data=(await openLibraryJSON(url)??{}) as {docs?:Array<{title?:string;author_name?:string[];cover_i?:number;isbn?:string[];number_of_pages_median?:number}>};
  const books:SearchBook[]=(Array.isArray(data.docs)?data.docs:[]).slice(0,12).filter(d=>typeof d.title==='string').map(d=>({
    title:d.title!.slice(0,500),author:Array.isArray(d.author_name)?d.author_name.slice(0,4).join(', ').slice(0,500):'Unknown author',
    coverUrl:typeof d.cover_i==='number'&&d.cover_i>0?`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`:'',
    ...(Array.isArray(d.isbn)&&d.isbn[0]?{isbn:String(d.isbn[0]).slice(0,32)}:{}),
    ...(typeof d.number_of_pages_median==='number'&&d.number_of_pages_median>0&&d.number_of_pages_median<100000?{pages:Math.round(d.number_of_pages_median)}:{}),
  }));
  if(recent.size>=100)recent.delete(recent.keys().next().value!);recent.set(query.toLocaleLowerCase(),{expires:Date.now()+3600000,books});return books;
}
