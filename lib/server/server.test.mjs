import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercise the production TypeScript modules using the repository's compiler.
// Output lives only in ignored test scratch, so no runtime test dependency is needed.
mkdirSync('.sites-runtime',{recursive:true});
const dir=mkdtempSync(resolve('.sites-runtime/server-test-'));
function compile(source,name){
  const code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from '../types'","from './types.mjs'");
  const output=resolve(dir,name+'.mjs');writeFileSync(output,code);return pathToFileURL(output).href;
}
compile('lib/types.ts','types');
const {stateSchema,makePublication,referencedAssets}=await import(compile('lib/server/validation.ts','validation'));
const {detectedFileType}=await import(compile('lib/server/file-types.ts','file-types'));
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));

function state(){return {schemaVersion:1,profile:{name:'A reader',bio:'Private bio'},books:[{
  id:'book1',title:'A book',author:'An author',coverUrl:'/api/assets/cover1',color:'#aabbcc',status:'reading',progress:40,rating:4,
  review:'SECRET_REVIEW',notes:'SECRET_NOTES',addedAt:'2026-01-01T00:00:00.000Z',sources:[{id:'source1',kind:'file',label:'SECRET_SOURCE',assetId:'SECRET_FILE'}],
},{id:'stagedBook',title:'PRIVATE_STAGED_TITLE',author:'An author',coverUrl:'',color:'#ffffff',status:'unread',progress:0,rating:null,review:'',notes:'',addedAt:'2026-01-01T00:00:00.000Z',sources:[]}],shelves:[{
  id:'shelf1',title:'My shelf',description:'For everyone',bookcase:'open',layout:'balanced',finish:'paper',updatedAt:'2026-01-01T00:00:00.000Z',items:[
    {id:'item1',kind:'book',bookId:'book1',slot:0,pinned:false,facing:'auto'},
    {id:'item2',kind:'decor',decor:'image',assetId:'decor1',slot:1,pinned:false,facing:'auto'},
    {id:'staged',kind:'book',bookId:'stagedBook',slot:null,pinned:false,facing:'auto'},
  ],
}]};}

test('valid library allows books with no ownership and no file sources',()=>{
  assert.equal(stateSchema.safeParse(state()).success,true);
});
test('rejects active URLs, over-capacity placements, duplicate positions and dangling books',()=>{
  for(const mutate of [
    s=>s.books[0].coverUrl='javascript:alert(1)',
    s=>s.books[0].sources[0].url='data:text/html,hello',
    s=>s.shelves[0].items[0].slot=999,
    s=>s.shelves[0].items[1].slot=0,
    s=>s.shelves[0].items[0].bookId='missing',
  ]){const s=state();mutate(s);assert.equal(stateSchema.safeParse(s).success,false);}
});
test('unknown properties are stripped on save',()=>{
  const s=state();s.admin=true;s.books[0].ownerId='someone_else';
  const parsed=stateSchema.parse(s);assert.equal(parsed.admin,undefined);assert.equal(parsed.books[0].ownerId,undefined);
});
test('public snapshot contains only visible books and never private metadata or file identifiers',()=>{
  const publication=makePublication(state(),'shelf1','pub1','2026-01-01',new Set(['cover1','decor1']));
  const output=JSON.stringify(publication);
  for(const secret of ['SECRET_REVIEW','SECRET_NOTES','SECRET_SOURCE','SECRET_FILE','PRIVATE_STAGED_TITLE','Private bio','sources','assetId'])assert.equal(output.includes(secret),false,secret);
  assert.equal(publication.books.length,1);assert.equal(publication.shelf.items.length,2);
  assert.equal(publication.books[0].coverUrl,'/api/publications/pub1/assets/cover1');
  assert.equal(publication.shelf.items[1].imageUrl,'/api/publications/pub1/assets/decor1');
});
test('unverified private cover and decor assets have no public URL',()=>{
  const p=makePublication(state(),'shelf1','pub1','2026-01-01',new Set());
  assert.equal(p.books[0].coverUrl,'');assert.equal(p.shelf.items[1].imageUrl,undefined);
  const s=state();s.books[0].coverUrl='https://cybershelf.io/api/assets/SECRET_FILE';
  assert.equal(makePublication(s,'shelf1','pub1','2026-01-01',new Set()).books[0].coverUrl,'');
});
test('asset references retain required kinds for ownership verification',()=>{
  const refs=referencedAssets(state());
  assert.deepEqual(refs,[{id:'SECRET_FILE',kind:'book'},{id:'cover1',kind:'image'},{id:'decor1',kind:'image'}]);
});
test('file sniffing does not trust names and rejects HTML or generic ZIP uploads',()=>{
  const bytes=v=>new TextEncoder().encode(v);
  assert.equal(detectedFileType(bytes('<html>not a PDF</html>')),null);
  assert.equal(detectedFileType(new Uint8Array([80,75,3,4,0,0,0,0])),null);
  assert.equal(detectedFileType(bytes('%PDF-1.7\n')).mime,'application/pdf');
  assert.equal(detectedFileType(new Uint8Array([137,80,78,71,13,10,26,10])).mime,'image/png');
  const epub=new Uint8Array(58);epub.set([80,75,3,4]);epub[26]=8;epub.set(bytes('mimetype'),30);epub.set(bytes('application/epub+zip'),38);
  assert.equal(detectedFileType(epub).mime,'application/epub+zip');
});
