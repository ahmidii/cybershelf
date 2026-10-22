import { test } from 'node:test';
import assert from 'node:assert/strict';

const base=process.env.CYBERSHELF_TEST_BASE_URL;
if(base && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(base))throw new Error('Integration fixtures may only run against a local preview.');

test('private state, originals and publication boundaries',{skip:!base},async()=>{
  const suffix=crypto.randomUUID();const owner='test_'+suffix,other='other_'+suffix;
  const headers=(id)=>id?{'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.invalid'}:{};
  const call=(path,id,init={})=>fetch(new URL(path,base),{...init,headers:{...headers(id),...(init.headers??{})}});
  const save=(state,version,id=owner)=>call('/api/state',id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,version})});
  const empty={schemaVersion:1,profile:{name:'Integration reader',bio:''},books:[],shelves:[]};
  let fileId,imageId,pubId,version=0;
  try {
    assert.equal((await call('/api/state',null)).status,401);
    const initial=await call('/api/state',owner);assert.equal(initial.status,200);assert.equal((await initial.json()).state,null);
    const upload=new FormData();upload.set('kind','book');upload.set('file',new File(['%PDF-1.7\nprivate-original'], 'private.pdf',{type:'application/pdf'}));
    const uploaded=await call('/api/assets',owner,{method:'POST',body:upload});assert.equal(uploaded.status,201);fileId=(await uploaded.json()).id;
    assert.equal((await call('/api/assets/'+fileId,null)).status,401);
    assert.equal((await call('/api/assets/'+fileId,other)).status,404);
    assert.equal(await (await call('/api/assets/'+fileId,owner)).text(),'%PDF-1.7\nprivate-original');
    const image=new FormData();image.set('kind','image');image.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'private-cover.png',{type:'image/png'}));
    const imageResponse=await call('/api/assets',owner,{method:'POST',body:image});assert.equal(imageResponse.status,201);imageId=(await imageResponse.json()).id;
    const state={...empty,books:[{id:'book1',title:'Book',author:'Author',coverUrl:'/api/assets/'+imageId,color:'#aabbcc',status:'reading',progress:22,rating:4,review:'secret-review',notes:'secret-note',addedAt:new Date().toISOString(),sources:[{id:'source1',kind:'file',label:'Private PDF',assetId:fileId}]}],shelves:[{id:'shelf1',title:'Shared shelf',description:'Public description',bookcase:'open',layout:'balanced',finish:'paper',updatedAt:new Date().toISOString(),items:[{id:'item1',kind:'book',bookId:'book1',slot:0,pinned:false,facing:'auto'}]}]};
    const saved=await save(state,0);assert.equal(saved.status,200);version=(await saved.json()).version;assert.equal(version,1);
    assert.equal((await save(state,0)).status,409);
    assert.equal((await save(state,0,other)).status,400,'A different account cannot adopt private file references');
    const pub=await call('/api/publications',owner,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shelfId:'shelf1'})});assert.equal(pub.status,201);pubId=(await pub.json()).id;
    const snapshot=await call('/api/publications/'+pubId,null);assert.equal(snapshot.status,200);const publicText=await snapshot.text();
    for(const privateValue of [fileId,'secret-review','secret-note','Private PDF'])assert.equal(publicText.includes(privateValue),false,privateValue);
    const publicImage=await call(`/api/publications/${pubId}/assets/${imageId}`,null);assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('content-disposition').includes('private-cover'),false);
    assert.equal((await call(`/api/publications/${pubId}/assets/${fileId}`,null)).status,404,'Book files never become publication assets');
    assert.equal((await call('/api/publications/'+pubId,other,{method:'DELETE'})).status,404);
    assert.equal((await call('/api/assets/'+fileId,owner,{method:'DELETE'})).status,409,'Referenced originals cannot be deleted silently');
    const revoked=await call('/api/publications/'+pubId,owner,{method:'DELETE'});assert.equal(revoked.status,200);pubId=undefined;
    assert.equal((await call(JSON.parse(publicText).books[0].coverUrl,null)).status,404,'Revocation removes public image access');
  }finally{
    if(pubId)await call('/api/publications/'+pubId,owner,{method:'DELETE'});
    if(version){const cleared=await save(empty,version);assert.equal(cleared.status,200);}
    for(const id of [fileId,imageId])if(id)await call('/api/assets/'+id,owner,{method:'DELETE'});
  }
});
