import { z } from 'zod';
import { shelfCapacity, type AppState, type Publication } from '../types';

export const idSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const text = (max: number) => z.string().max(max);
const date = z.string().max(40).refine(v => Number.isFinite(Date.parse(v)), 'Invalid date');
const url = z.string().max(2048).refine(v => {
  if (!v) return true;
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}, 'Use a complete http or https URL');
const publicImagePath = /^\/api\/publications\/[A-Za-z0-9_-]+\/assets\/[A-Za-z0-9_-]+$/;
const imageUrl = z.string().max(2048).refine(v => !v || /^\/api\/assets\/[A-Za-z0-9_-]+$/.test(v) || publicImagePath.test(v) || url.safeParse(v).success, 'Invalid image URL');

const source = z.object({
  id: idSchema, kind: z.enum(['file', 'platform', 'physical', 'link']), label: text(150),
  url: url.optional(), assetId: idSchema.optional(), filename: text(255).optional(), location: text(500).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'file' && !v.assetId) ctx.addIssue({code: z.ZodIssueCode.custom, message:'A file source needs an uploaded file', path:['assetId']});
});
const book = z.object({
  id: idSchema, title: z.string().min(1).max(500), author: text(500), coverUrl: imageUrl,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), isbn: text(32).optional(), description: text(10000).optional(),
  pages: z.number().int().min(0).max(100000).optional(), status: z.enum(['unread','reading','read','paused','dnf']),
  progress: z.number().min(0).max(100), rating: z.number().min(0).max(5).nullable(),
  review: text(20000), notes: text(30000), addedAt: date, finishedAt: date.optional(), sources: z.array(source).max(30),
});
const item = z.object({
  id:idSchema, kind:z.enum(['book','decor']), bookId:idSchema.optional(), decor:z.enum(['plant','bear','robot','vase','bookend','image']).optional(),
  assetId:idSchema.optional(), imageUrl:imageUrl.optional(), label:text(150).optional(), slot:z.number().int().min(0).max(1000).nullable(),
  pinned:z.boolean(), facing:z.enum(['auto','spine','cover','stack']),
});
const shelf = z.object({
  id:idSchema, title:z.string().min(1).max(150), description:text(2000), bookcase:z.enum(['open','cubby','tower']),
  layout:z.enum(['balanced','gallery','stacks']), finish:z.enum(['paper','oak','moss','ink']),
  items:z.array(item).max(2000), updatedAt:date, publicId:idSchema.optional(),
});

export const stateSchema = z.object({
  schemaVersion:z.literal(1), profile:z.object({name:z.string().min(1).max(80),bio:text(1000)}),
  books:z.array(book).max(2000), shelves:z.array(shelf).max(100),
}).superRefine((state, ctx) => {
  const books = new Set<string>();
  for (const b of state.books) {
    if (books.has(b.id)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate book ID'});
    books.add(b.id);
    if (new Set(b.sources.map(s => s.id)).size !== b.sources.length) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate source ID'});
  }
  const shelves = new Set<string>();
  for (const s of state.shelves) {
    if (shelves.has(s.id)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate shelf ID'});
    shelves.add(s.id);
    const slots = new Set<number>(); const items = new Set<string>();
    for (const i of s.items) {
      if (items.has(i.id)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate item ID'});
      items.add(i.id);
      if (i.kind === 'book' && (!i.bookId || !books.has(i.bookId))) ctx.addIssue({code:z.ZodIssueCode.custom,message:'A shelf references a missing book'});
      if (i.kind === 'decor' && !i.decor) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Decoration type is missing'});
      if (i.kind === 'decor' && i.decor === 'image' && !i.assetId && !i.imageUrl) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Decoration image is missing'});
      if (i.slot !== null) {
        if (i.slot >= shelfCapacity(s) || slots.has(i.slot)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Two objects occupy a position, or a position is outside this shelf'});
        slots.add(i.slot);
      }
    }
  }
});

export const saveSchema = z.object({state:stateSchema,version:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)});

export function privateImageId(value: string | undefined): string | null {
  return value?.match(/^\/api\/assets\/([A-Za-z0-9_-]+)$/)?.[1] ?? null;
}

export function referencedAssets(state: AppState): {id:string;kind:'book'|'image'}[] {
  const refs: {id:string;kind:'book'|'image'}[] = [];
  for (const b of state.books) {
    for (const s of b.sources) if (s.kind==='file' && s.assetId) refs.push({id:s.assetId,kind:'book'});
    const cover = privateImageId(b.coverUrl); if (cover) refs.push({id:cover,kind:'image'});
  }
  for (const s of state.shelves) for (const item of s.items) if (item.kind==='decor') {
    if (item.assetId) refs.push({id:item.assetId,kind:'image'});
    const img = privateImageId(item.imageUrl); if (img) refs.push({id:img,kind:'image'});
  }
  return refs;
}

/** Explicit field allowlist: private Library data never enters a publication. */
export function makePublication(state:AppState, shelfId:string, id:string, publishedAt:string, imageIds:Set<string>):Publication {
  const original = state.shelves.find(s => s.id===shelfId);
  if (!original) throw new Error('Shelf not found');
  const publicImage = (value:string) => {
    const privateId=privateImageId(value);
    if (privateId) return imageIds.has(privateId)?`/api/publications/${id}/assets/${privateId}`:'';
    try { if(new URL(value).pathname.startsWith('/api/assets/'))return ''; } catch { /* relative public image below */ }
    return publicImagePath.test(value)||url.safeParse(value).success ? value : '';
  };
  const visible = original.items.filter(i=>i.slot!==null);
  const bookIds=new Set(visible.filter(i=>i.kind==='book').map(i=>i.bookId));
  const books=state.books.filter(b=>bookIds.has(b.id)).map(b=>({id:b.id,title:b.title,author:b.author,coverUrl:publicImage(b.coverUrl),color:b.color}));
  const items=visible.map(i=>{
    if(i.kind==='book') return {id:i.id,kind:'book' as const,bookId:i.bookId,slot:i.slot,pinned:i.pinned,facing:i.facing};
    const imageId=i.assetId??privateImageId(i.imageUrl)??undefined;
    return {id:i.id,kind:'decor' as const,decor:i.decor,slot:i.slot,pinned:i.pinned,facing:i.facing,label:i.label,
      ...(imageId && imageIds.has(imageId) ? {imageUrl:`/api/publications/${id}/assets/${imageId}`} : i.imageUrl ? {imageUrl:publicImage(i.imageUrl)} : {})};
  });
  return {id,name:state.profile.name,books,bookCount:books.length,publishedAt,shelf:{
    id:original.id,title:original.title,description:original.description,bookcase:original.bookcase,layout:original.layout,
    finish:original.finish,updatedAt:original.updatedAt,publicId:id,items,
  }};
}
