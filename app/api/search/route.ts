import { handled, HttpError, json } from '@/lib/server/http';
import type { SearchBook } from '@/lib/types';

export const dynamic='force-dynamic';
const recent=new Map<string,{expires:number;books:SearchBook[]}>();
const inFlight=new Map<string,Promise<SearchBook[]>>();
let lastRequest=0;
export async function GET(request:Request){return handled(async()=>{
  const query=(new URL(request.url).searchParams.get('q')??'').trim().slice(0,200);
  if(query.length<2)return json({books:[]});
  const key=query.toLocaleLowerCase();const cached=recent.get(key);if(cached&&cached.expires>Date.now())return json({books:cached.books});
  let promise=inFlight.get(key);
  if(!promise){
    if(Date.now()-lastRequest<1000)throw new HttpError(429,'Please wait a moment before searching again.');
    lastRequest=Date.now();promise=lookup(query);inFlight.set(key,promise);
  }
  try{const books=await promise;return json({books});}finally{inFlight.delete(key);}
});}
async function lookup(query:string):Promise<SearchBook[]>{
  const url=new URL('https://openlibrary.org/search.json');url.searchParams.set('q',query);url.searchParams.set('limit','12');url.searchParams.set('fields','key,title,author_name,cover_i,isbn,number_of_pages_median');
  let response:Response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(6500),headers:{'User-Agent':'cybershelf/0.1 (https://cybershelf.io)','Accept':'application/json'}});}catch{throw new HttpError(503,'Book search is taking a break. You can still add a book manually.');}
  if(!response.ok)throw new HttpError(503,'Book search is unavailable. You can still add a book manually.');
  const data=await response.json() as {docs?:Array<{title?:string;author_name?:string[];cover_i?:number;isbn?:string[];number_of_pages_median?:number}>};
  const books:SearchBook[]=(Array.isArray(data.docs)?data.docs:[]).slice(0,12).filter(d=>typeof d.title==='string').map(d=>({
    title:d.title!.slice(0,500),author:Array.isArray(d.author_name)?d.author_name.slice(0,4).join(', ').slice(0,500):'Unknown author',
    coverUrl:typeof d.cover_i==='number'&&d.cover_i>0?`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`:'',
    ...(Array.isArray(d.isbn)&&d.isbn[0]?{isbn:String(d.isbn[0]).slice(0,32)}:{}),
    ...(typeof d.number_of_pages_median==='number'&&d.number_of_pages_median>0&&d.number_of_pages_median<100000?{pages:Math.round(d.number_of_pages_median)}:{}),
  }));
  if(recent.size>=100)recent.delete(recent.keys().next().value!);recent.set(query.toLocaleLowerCase(),{expires:Date.now()+3600000,books});return books;
}
