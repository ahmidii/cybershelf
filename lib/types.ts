export type ReadingStatus = 'unread' | 'reading' | 'read' | 'paused' | 'dnf';
export type SourceKind = 'file' | 'platform' | 'physical' | 'link';
export interface BookSource { id: string; kind: SourceKind; label: string; url?: string; assetId?: string; filename?: string; location?: string; }
export interface Book {
  id: string; title: string; author: string; coverUrl: string; color: string;
  isbn?: string; description?: string; pages?: number;
  status: ReadingStatus; progress: number; rating: number | null;
  review: string; notes: string; addedAt: string; finishedAt?: string;
  sources: BookSource[];
}
export type Bookcase = 'open' | 'cubby' | 'tower';
export type ShelfLayout = 'balanced' | 'gallery' | 'stacks';
export type ShelfFinish = 'paper' | 'oak' | 'moss' | 'ink';
export type DecorKind = 'plant' | 'bear' | 'robot' | 'vase' | 'bookend' | 'image';
export interface ShelfItem {
  id: string; kind: 'book' | 'decor'; bookId?: string; decor?: DecorKind;
  assetId?: string; imageUrl?: string; label?: string;
  slot: number | null; pinned: boolean; facing: 'auto' | 'spine' | 'cover' | 'stack';
}
export interface Shelf {
  id: string; title: string; description: string;
  bookcase: Bookcase; layout: ShelfLayout; finish: ShelfFinish;
  items: ShelfItem[]; updatedAt: string; publicId?: string;
}
export interface Profile { name: string; bio: string; }
export interface AppState { schemaVersion: 1; profile: Profile; books: Book[]; shelves: Shelf[]; }
export interface StateResponse { state: AppState | null; version: number; user: { id: string; name: string }; }
export interface Asset { id: string; filename: string; mime: string; size: number; url: string; }
export interface PublicBook { id: string; title: string; author: string; coverUrl: string; color: string; }
export interface Publication {
  id: string; shelf: Shelf; books: PublicBook[]; name: string;
  publishedAt: string; bookCount: number;
}
export interface SearchBook { title: string; author: string; coverUrl: string; isbn?: string; pages?: number; }
export const FINISHES: {id:ShelfFinish;name:string;color:string}[] = [
  {id:'paper',name:'Paper',color:'#eeede6'}, {id:'oak',name:'Warm oak',color:'#b59168'},
  {id:'moss',name:'Moss',color:'#879479'}, {id:'ink',name:'Ink',color:'#373e39'},
];
export const BOOKCASES: {id:Bookcase;name:string;description:string}[] = [
  {id:'open',name:'Open shelves',description:'Long, quiet lines'},
  {id:'cubby',name:'Cubby',description:'Little worlds, side by side'},
  {id:'tower',name:'Tower',description:'A nook for every story'},
];
export function shelfGrid(shelf: Pick<Shelf,'bookcase'|'layout'>) {
  const base = shelf.bookcase==='tower' ? {rows:4,columns:4} : shelf.bookcase==='cubby' ? {rows:3,columns:6} : {rows:3,columns:8};
  return {...base, columns:shelf.layout==='gallery'?Math.max(2,Math.floor(base.columns/2)):base.columns};
}
export function shelfCapacity(shelf: Pick<Shelf,'bookcase'|'layout'>) { const g=shelfGrid(shelf); return g.rows*g.columns; }
export function uid(prefix='') { return prefix+crypto.randomUUID(); }
export function emptyState(): AppState { return {schemaVersion:1,profile:{name:'Reader',bio:''},books:[],shelves:[]}; }
export function newShelf(title='A shelf of my own'): Shelf { return {id:uid('sh_'),title,description:'',bookcase:'open',layout:'balanced',finish:'paper',items:[],updatedAt:new Date().toISOString()}; }
export function newBook(title:string,author='Unknown author'): Book { return {id:uid('bk_'),title,author,coverUrl:'',color:'#6d7c68',status:'unread',progress:0,rating:null,review:'',notes:'',addedAt:new Date().toISOString(),sources:[]}; }
export function assetUrl(id:string) { return '/api/assets/'+encodeURIComponent(id); }
export function safeExternalUrl(value:string) { try {const url=new URL(value); return ['https:','http:'].includes(url.protocol)?url.href:null;} catch{return null;} }
export function firstEmptySlot(shelf:Shelf) { const used=new Set(shelf.items.map(i=>i.slot)); for(let n=0;n<shelfCapacity(shelf);n++)if(!used.has(n))return n; return null; }
export function resizeShelf(shelf:Shelf,change:Partial<Pick<Shelf,'bookcase'|'layout'|'finish'>>):Shelf {
  const next={...shelf,...change}; const cap=shelfCapacity(next);
  return {...next,items:next.items.map(item=>item.slot!==null&&item.slot>=cap?{...item,slot:null}:item)};
}
