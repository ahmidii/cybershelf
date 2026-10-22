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
const {stateSchema,makePublication,makePublicProfile,makeReadingSnapshot,referencedAssets}=await import(compile('lib/server/validation.ts','validation'));
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
test('continuous positions accept more books than the old gallery cells and retain exact coordinates',()=>{
  const value=state();value.shelves[0].layout='gallery';
  value.shelves[0].items=Array.from({length:9},(_,index)=>({
    id:`free_${index}`,kind:'book',bookId:'book1',slot:100+index,pinned:false,facing:'spine',placement:{row:0,x:.05+index*.1},
  }));
  const parsed=stateSchema.parse(value);
  assert.equal(parsed.shelves[0].items.length,9);
  assert.deepEqual(parsed.shelves[0].items.map(item=>item.placement),value.shelves[0].items.map(item=>item.placement));
});
test('continuous coordinates and support graphs are validated before saving',()=>{
  const value=state();
  value.shelves[0].items[0].placement={row:0,x:.3};
  value.shelves[0].items[1].placement={row:0,x:.3,supportId:'item1'};
  assert.equal(stateSchema.safeParse(value).success,true);
  for(const mutate of [
    s=>s.shelves[0].items[0].placement.x=NaN,
    s=>s.shelves[0].items[0].placement.x=Infinity,
    s=>s.shelves[0].items[0].placement.x=-.1,
    s=>s.shelves[0].items[0].placement.x=1.01,
    s=>s.shelves[0].items[0].placement.row=3,
    s=>s.shelves[0].items[0].placement.row=1.5,
    s=>s.shelves[0].items[1].placement.supportId='missing',
    s=>s.shelves[0].items[1].placement.supportId='staged',
    s=>s.shelves[0].items[1].placement.supportId='item2',
    s=>s.shelves[0].items[1].placement.row=1,
    s=>s.shelves[0].items[0].placement.supportId='item2',
    s=>s.shelves[0].items[0].slot=null,
    s=>s.shelves[0].items[0].slot=1001,
  ]){const invalid=structuredClone(value);mutate(invalid);assert.equal(stateSchema.safeParse(invalid).success,false);}
});
test('public shelf and profile snapshots allowlist continuous placements and keep stack supports',()=>{
  const value=state();value.profile.featuredShelfId='shelf1';
  value.shelves[0].items[0].placement={row:1,x:.41813,privateExtra:'PRIVATE_PLACEMENT'};
  value.shelves[0].items[1].placement={row:1,x:.41813,supportId:'item1',privateExtra:'PRIVATE_PLACEMENT'};
  const parsed=stateSchema.parse(value);
  assert.equal(parsed.shelves[0].items[0].placement.privateExtra,undefined);
  const shelf=makePublication(value,'shelf1','pub1','2026-01-01',new Set(['cover1','decor1']));
  const profile=makePublicProfile(value,'reader1','2026-01-01','2026-01-01',new Set(['cover1','decor1']));
  for(const snapshot of [shelf,profile.featured]){
    assert.deepEqual(snapshot.shelf.items[0].placement,{row:1,x:.41813});
    assert.deepEqual(snapshot.shelf.items[1].placement,{row:1,x:.41813,supportId:'item1'});
    assert.equal(JSON.stringify(snapshot).includes('PRIVATE_PLACEMENT'),false);
    assert.equal(snapshot.shelf.items.some(item=>item.id==='staged'),false);
  }
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
test('physical book appearance remains bounded and old libraries need no migration',()=>{
  assert.equal(stateSchema.safeParse(state()).success,true);
  const value=state();value.profile.featuredShelfId='shelf1';
  value.books[0].dimensions={heightMm:218,widthMm:140,thicknessMm:24,source:'catalog'};
  value.books[0].format='hardcover';value.books[0].spineUrl='/api/assets/spine1';value.shelves[0].items[0].lean='left';
  assert.equal(stateSchema.safeParse(value).success,true);
  assert.ok(referencedAssets(value).some(ref=>ref.id==='spine1'&&ref.kind==='image'));
  for(const mutate of [s=>s.profile.featuredShelfId='missing',s=>s.books[0].dimensions.heightMm=Infinity,s=>s.books[0].dimensions.thicknessMm=0,s=>s.books[0].dimensions.widthMm=401,s=>s.books[0].spineUrl='javascript:alert(1)',s=>s.shelves[0].items[0].lean='floating']){
    const broken=structuredClone(value);mutate(broken);assert.equal(stateSchema.safeParse(broken).success,false);
  }
});
test('public snapshots preserve book proportions, spines and lean without exposing private book fields',()=>{
  const value=state();value.books[0].pages=384;value.books[0].format='hardcover';
  value.books[0].dimensions={heightMm:218,widthMm:140,thicknessMm:24,source:'manual',secret:'PRIVATE_DIMENSION_FIELD'};
  value.books[0].spineUrl='/api/assets/spine1';value.shelves[0].items[0].lean='right';
  const publicValue=makePublication(value,'shelf1','pub1','2026-01-01',new Set(['cover1','spine1']));
  assert.deepEqual(publicValue.books[0].dimensions,{heightMm:218,widthMm:140,thicknessMm:24,source:'manual'});
  assert.equal(publicValue.books[0].pages,384);assert.equal(publicValue.books[0].format,'hardcover');
  assert.equal(publicValue.books[0].spineUrl,'/api/publications/pub1/assets/spine1');
  assert.equal(publicValue.shelf.items[0].lean,'right');
  for(const secret of ['SECRET_REVIEW','SECRET_NOTES','SECRET_SOURCE','SECRET_FILE','PRIVATE_DIMENSION_FIELD'])assert.equal(JSON.stringify(publicValue).includes(secret),false);
  assert.equal(makePublication(value,'shelf1','pub1','2026-01-01',new Set()).books[0].spineUrl,'');
});
test('profile snapshots require a deliberate selection and include exactly that shelf',()=>{
  const value=state();assert.throws(()=>makePublicProfile(value,'reader1','2026-01-01','2026-01-01',new Set()),/featured shelf/);
  value.profile.featuredShelfId='shelf1';value.profile.bio='A deliberately public bio';
  value.shelves.push({...structuredClone(value.shelves[0]),id:'private-shelf',title:'PRIVATE_SHELF_NAME'});
  const profile=makePublicProfile(value,'reader1','2026-01-01','2026-01-02',new Set(['cover1','decor1']));
  assert.equal(profile.name,value.profile.name);assert.equal(profile.bio,value.profile.bio);
  assert.equal(profile.featured.shelf.id,'shelf1');assert.equal(profile.featured.shelf.publicId,undefined);
  assert.equal(profile.featured.books[0].coverUrl,'/api/profiles/reader1/assets/cover1');
  assert.equal(profile.featured.shelf.items[1].imageUrl,'/api/profiles/reader1/assets/decor1');
  for(const secret of ['PRIVATE_SHELF_NAME','PRIVATE_STAGED_TITLE','SECRET_REVIEW','SECRET_NOTES','SECRET_FILE'])assert.equal(JSON.stringify(profile).includes(secret),false,secret);
});
test('reading entries accept start and finish milestones, bound content and have global stable IDs',()=>{
  const value=state();value.books[0].readingLog=[{id:'log1',body:'',progress:0,page:0,createdAt:'2026-01-01T00:00:00Z'},{id:'log2',body:'A finishing thought',progress:100,page:218,createdAt:'2026-01-02T00:00:00Z'}];
  assert.equal(stateSchema.safeParse(value).success,true);
  for(const mutate of [s=>s.books[0].readingLog[0].progress=-1,s=>s.books[0].readingLog[0].progress=101,s=>s.books[0].readingLog[0].body='x'.repeat(4001),s=>s.books[0].readingLog[0].page=1.5,s=>s.books[1].readingLog=[structuredClone(s.books[0].readingLog[0])]]){
    const broken=structuredClone(value);mutate(broken);assert.equal(stateSchema.safeParse(broken).success,false);
  }
});
test('reading logs stay out of shelves and profiles; explicitly shared entries expose only their own text',()=>{
  const value=state();value.profile.featuredShelfId='shelf1';value.books[0].readingLog=[{id:'log1',body:'A deliberately shared thought',progress:35,page:70,createdAt:'2026-01-01T00:00:00Z',ownerId:'PRIVATE_EXTRA'},{id:'log2',body:'PRIVATE_OTHER_ENTRY',progress:70,createdAt:'2026-01-02T00:00:00Z'}];
  const shelf=makePublication(value,'shelf1','pub1','2026-01-01',new Set(['cover1']));
  const profile=makePublicProfile(value,'reader1','2026-01-01','2026-01-01',new Set(['cover1']));
  for(const output of [shelf,profile])for(const text of ['readingLog','A deliberately shared thought','PRIVATE_OTHER_ENTRY'])assert.equal(JSON.stringify(output).includes(text),false);
  const snapshot=makeReadingSnapshot(value.books[0],value.books[0].readingLog[0],'post1',new Set(['cover1']));
  assert.deepEqual(snapshot.entry,{id:'log1',body:'A deliberately shared thought',progress:35,page:70,createdAt:'2026-01-01T00:00:00Z'});
  assert.equal(snapshot.book.coverUrl,'/api/journal/post1/assets/cover1');
  for(const secret of ['SECRET_NOTES','SECRET_REVIEW','SECRET_FILE','PRIVATE_OTHER_ENTRY','PRIVATE_EXTRA','sources','readingLog'])assert.equal(JSON.stringify(snapshot).includes(secret),false,secret);
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
