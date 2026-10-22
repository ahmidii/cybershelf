export type ReadingStatus = 'unread' | 'reading' | 'read' | 'paused' | 'dnf';
export type SourceKind = 'file' | 'platform' | 'physical' | 'link';
export interface BookSource { id: string; kind: SourceKind; label: string; url?: string; assetId?: string; filename?: string; location?: string; }
export type BookFormat = 'paperback' | 'hardcover' | 'pocket' | 'large';
export interface BookDimensions {
  heightMm: number; widthMm: number; thicknessMm: number;
  source: 'estimated' | 'catalog' | 'manual';
}
export interface ReadingLogEntry {
  id: string; body: string; progress: number; page?: number;
  createdAt: string;
}
/** Public-provider credentials never belong in these persisted records. */
export interface ImportedBookFields {
  title?: string; author?: string; coverUrl?: string; isbn?: string; pages?: number;
  status?: ReadingStatus; progress?: number; rating?: number | null;
}
export interface BookConnectionRecord {
  connectionId: string; remoteId: string; sourceId: string;
  lastImported: ImportedBookFields;
}
export interface LibraryConnection {
  id: string; provider: 'hardcover'; accountKey: string; label: string;
  autoSync: boolean; syncProgress: boolean; connectedAt: string;
  lastSyncedAt?: string;
  lastSummary?: { added: number; updated: number; preserved: number };
}
export interface Book {
  id: string; title: string; author: string; coverUrl: string; color: string;
  isbn?: string; description?: string; pages?: number;
  format?: BookFormat; dimensions?: BookDimensions; spineUrl?: string;
  readingLog?: ReadingLogEntry[];
  status: ReadingStatus; progress: number; rating: number | null;
  review: string; notes: string; addedAt: string; finishedAt?: string;
  sources: BookSource[];
  connections?: BookConnectionRecord[];
}
export type Bookcase = 'open' | 'cubby' | 'tower';
export type ShelfLayout = 'balanced' | 'gallery' | 'stacks';
export type ShelfFinish = 'paper' | 'oak' | 'moss' | 'ink';
export type DecorKind = 'plant' | 'bear' | 'robot' | 'vase' | 'bookend' | 'image';
/** Continuous position. x is the centre of the object across the whole row.
 * The support reference is another item on this row; absent means the plank. */
export interface ShelfPlacement { row: number; x: number; supportId?: string; }
export interface ShelfItem {
  id: string; kind: 'book' | 'decor'; bookId?: string; decor?: DecorKind;
  assetId?: string; imageUrl?: string; label?: string;
  slot: number | null; pinned: boolean; facing: 'auto' | 'spine' | 'cover' | 'stack';
  lean?: 'auto' | 'upright' | 'left' | 'right';
  placement?: ShelfPlacement;
}
export interface Shelf {
  id: string; title: string; description: string;
  bookcase: Bookcase; layout: ShelfLayout; finish: ShelfFinish;
  items: ShelfItem[]; updatedAt: string; publicId?: string;
}
export interface Profile { name: string; bio: string; featuredShelfId?: string; }
export interface AppState { schemaVersion: 1; profile: Profile; books: Book[]; shelves: Shelf[]; connections?: LibraryConnection[]; }
export interface StateResponse { state: AppState | null; version: number; user: { id: string; name: string }; }
export interface Asset { id: string; filename: string; mime: string; size: number; url: string; }
export interface PublicBook { id: string; title: string; author: string; coverUrl: string; color: string; pages?: number; format?: BookFormat; dimensions?: BookDimensions; spineUrl?: string; }
export interface Publication {
  id: string; shelf: Shelf; books: PublicBook[]; name: string;
  publishedAt: string; bookCount: number; profileId?: string;
}
export interface PublicProfile { id: string; name: string; bio: string; featured: Publication; publishedAt: string; updatedAt: string; }
export interface ReadingPost {
  id: string; profileId: string; name: string; book: PublicBook;
  entry: ReadingLogEntry; publishedAt: string; commentCount: number;
}
export interface ReadingComment {
  id: string; body: string; progress: number; name: string;
  profileId?: string; createdAt: string; canDelete?: boolean;
}
export interface ActivityEvent {
  id: string; kind: 'reading' | 'comment' | 'shelf' | 'shelf_updated' | 'purchased' | 'added';
  createdAt: string; actor: { id: string; name: string };
  book?: PublicBook; progress?: number; body?: string; postId?: string;
  shelf?: Publication; commentId?: string;
}
export interface SearchBook { title: string; author: string; coverUrl: string; isbn?: string; pages?: number; format?: BookFormat; dimensions?: BookDimensions; }
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
/** Validate the support graph without recursion, including imported shelves.
 * Slots identify visible legacy items; they no longer determine capacity once
 * an item has a continuous placement. */
export function shelfPlacementError(shelf: Pick<Shelf, 'bookcase' | 'layout' | 'items'>): string | null {
  const grid = shelfGrid(shelf), byId = new Map(shelf.items.map(item => [item.id, item]));
  for (const item of shelf.items) {
    const position = item.placement;
    if (!position) continue;
    if (item.slot === null) return 'An item in the tray cannot have a shelf placement.';
    if (!Number.isInteger(position.row) || position.row < 0 || position.row >= grid.rows) return 'A shelf placement has an invalid row.';
    if (!Number.isFinite(position.x) || position.x < 0 || position.x > 1) return 'A shelf placement must stay within the shelf.';
    if (position.supportId) {
      const support = byId.get(position.supportId);
      if (!support || support.slot === null) return 'A shelf placement refers to a missing support.';
      if (support.id === item.id) return 'A shelf item cannot support itself.';
      const supportRow = support.placement?.row ?? Math.floor(support.slot / grid.columns);
      if (supportRow !== position.row) return 'A shelf item and its support must be on the same row.';
    }
  }
  const finished = new Set<string>();
  for (const item of shelf.items) {
    const path = new Set<string>();
    let cursor: string | undefined = item.id;
    while (cursor && !finished.has(cursor)) {
      if (path.has(cursor)) return 'Shelf supports cannot form a circle.';
      path.add(cursor);
      cursor = byId.get(cursor)?.placement?.supportId;
    }
    for (const id of path) finished.add(id);
  }
  return null;
}
export function resizeShelf(shelf:Shelf,change:Partial<Pick<Shelf,'bookcase'|'layout'|'finish'>>):Shelf {
  const next={...shelf,...change}, previousGrid=shelfGrid(shelf), nextGrid=shelfGrid(next);
  const structureChanged=next.bookcase!==shelf.bookcase||next.layout!==shelf.layout;
  return {...next,items:next.items.map(item=>{
    if(item.slot===null){const {placement:_placement,...staged}=item;return staged;}
    const position=item.placement??(structureChanged?{
      row:Math.floor(item.slot/previousGrid.columns),x:(item.slot%previousGrid.columns+.5)/previousGrid.columns,
    }:undefined);
    return position?{...item,placement:{...position,row:Math.max(0,Math.min(nextGrid.rows-1,position.row)),x:Math.max(0,Math.min(1,position.x))}}:{...item};
  })};
}
