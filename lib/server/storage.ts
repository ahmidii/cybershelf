import { env } from 'cloudflare:workers';
import { HttpError } from './http';
import { referencedAssets } from './validation';
import type { AppState } from '../types';

export type LibraryRow = {owner_id:string;state:string;version:number;updated_at:string};
export type AssetRow = {id:string;owner_id:string;kind:'book'|'image';object_key:string;filename:string;mime:string;size:number;created_at:string};
export type PublicationRow = {id:string;owner_id:string;shelf_id:string;snapshot:string;image_ids:string;published_at:string;updated_at:string};
export function database(){if(!env.DB)throw new HttpError(503,'Library storage is not available yet.');return env.DB;}
export function bucket(){if(!env.BUCKET)throw new HttpError(503,'File storage is not available yet.');return env.BUCKET;}
export async function getLibrary(owner:string){return database().prepare('SELECT * FROM libraries WHERE owner_id = ?').bind(owner).first<LibraryRow>();}
export async function getAsset(id:string,owner?:string){return owner
  ? database().prepare('SELECT * FROM assets WHERE id = ? AND owner_id = ?').bind(id,owner).first<AssetRow>()
  : database().prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>();}
export async function checkAssetReferences(state:AppState,owner:string){
  const refs=referencedAssets(state);const ids=[...new Set(refs.map(a=>a.id))];const valid=new Map<string,string>();
  for(let offset=0;offset<ids.length;offset+=80){
    const chunk=ids.slice(offset,offset+80);const rows=await database().prepare(`SELECT id,kind FROM assets WHERE owner_id = ? AND id IN (${chunk.map(()=>'?').join(',')})`).bind(owner,...chunk).all<{id:string;kind:string}>();
    for(const row of rows.results)valid.set(row.id,row.kind);
  }
  if(refs.some(ref=>valid.get(ref.id)!==ref.kind))throw new HttpError(400,'An uploaded file is missing or belongs to another account. Remove the unavailable source and try again.');
}
export function assetResponse(object:R2ObjectBody,asset:AssetRow,publicImage=false){
  const filename=(publicImage?'cybershelf-image.'+(asset.mime==='image/png'?'png':asset.mime==='image/webp'?'webp':'jpg'):asset.filename).replace(/[\r\n\x00-\x1f"\\]/g,'_');
  return new Response(object.body,{headers:{
    'Content-Type':asset.mime,'Content-Length':String(object.size),'X-Content-Type-Options':'nosniff',
    'Cache-Control':publicImage?'no-store':'private, no-store',
    'Content-Disposition':`${asset.kind==='book'?'attachment':'inline'}; filename="${filename.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Security-Policy':"default-src 'none'; sandbox",
  }});
}
