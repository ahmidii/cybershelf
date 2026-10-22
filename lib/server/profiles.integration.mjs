import assert from 'node:assert/strict';

/** Runs inside the disposable Worker harness; never contacts production. */
export async function runProfileIntegration({state:original,version:initialVersion,call,save,expectStatus,imageId,fileId,pubId,ownerId,report,onVersion=()=>{}}){
  let state=structuredClone(original),version=initialVersion;
  const persist=async()=>{version=(await (await expectStatus(await save(state,version),200,'Save profile draft')).json()).version;onVersion(version);};
  const payload=()=>({shelfId:state.profile.featuredShelfId,name:state.profile.name,bio:state.profile.bio,shelfUpdatedAt:state.shelves.find(shelf=>shelf.id===state.profile.featuredShelfId)?.updatedAt});
  const publish=(body=payload(),account='owner',headers={})=>call('/api/profile',account,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await call('/api/profile',null)).status,401);
  assert.equal((await (await call('/api/profile','owner')).json()).profile,null);
  assert.equal((await (await call('/api/profile','other')).json()).profile,null);
  state.profile={...state.profile,featuredShelfId:'shelf1',bio:'A deliberately public reading life'};
  state.books[0].spineUrl='/api/assets/'+imageId;
  state.books[0].dimensions={heightMm:218,widthMm:140,thicknessMm:28,source:'manual'};
  state.shelves[0].items[0].lean='left';
  const hidden={...structuredClone(state.books[0]),id:'profile_hidden_book',title:'PROFILE_PRIVATE_BOOK',sources:[]};
  state.books.push(hidden);
  state.shelves.push({...structuredClone(state.shelves[0]),id:'profile_hidden_shelf',title:'PROFILE_PRIVATE_SHELF',items:[{id:'hidden_item',kind:'book',bookId:hidden.id,slot:0,pinned:false,facing:'cover'}]});
  await persist();
  for(const assetId of ['nonexistent_profile_decoration',fileId]){
    const invalid=structuredClone(state);
    invalid.shelves[0].items.push({id:'invalid_profile_decoration',kind:'decor',decor:'image',assetId,slot:1,pinned:false,facing:'auto'});
    assert.equal((await save(invalid,version)).status,400,'A nonexistent asset or private book file cannot be saved as profile decoration');
  }
  assert.equal((await (await call('/api/profile','owner')).json()).profile,null,'Choosing a featured shelf is private');
  const exploreBefore=(await (await call('/api/publications',null)).json()).items.map(item=>item.id).sort();
  assert.equal((await publish(payload(),'owner',{Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await publish({...payload(),shelfId:'profile_hidden_shelf'})).status,409,'The reviewed shelf must match the saved profile choice');
  assert.equal((await publish(payload(),'other')).status,409,'A different account cannot publish the owner’s saved Library');
  const simultaneous=await Promise.all([publish(),publish()]);
  const created=[];
  for(const response of simultaneous){assert.ok([200,201].includes(response.status),await response.clone().text());created.push(await response.json());}
  const firstId=created[0].profile.id;
  assert.equal(created[1].profile.id,firstId,'Concurrent first publications keep one stable public identity');
  assert.notEqual(firstId,ownerId,'Public URLs never expose the account identifier');
  let publicProfile=await (await expectStatus(await call('/api/profiles/'+firstId,null),200,'Public featured profile')).json();
  assert.equal(publicProfile.id,firstId);assert.equal(publicProfile.bio,state.profile.bio);
  assert.equal(publicProfile.featured.books.length,1);assert.equal(publicProfile.featured.shelf.id,'shelf1');
  assert.equal(publicProfile.featured.books[0].spineUrl,`/api/profiles/${firstId}/assets/${imageId}`);
  assert.deepEqual(publicProfile.featured.books[0].dimensions,state.books[0].dimensions);
  assert.equal(publicProfile.featured.shelf.items[0].lean,'left');
  for(const secret of ['PROFILE_PRIVATE_BOOK','PROFILE_PRIVATE_SHELF','secret-review','secret-note','Private PDF',fileId,ownerId])assert.equal(JSON.stringify(publicProfile).includes(secret),false,secret);
  assert.equal((await call(`/api/profiles/${firstId}/assets/${imageId}`,null)).status,200);
  assert.equal((await call(`/api/profiles/${firstId}/assets/${fileId}`,null)).status,404,'Originals never become profile artwork');
  assert.equal((await call(`/api/profiles/${firstId}/assets/not_allowlisted`,null)).status,404,'Unknown artwork cannot be fetched through a profile');
  assert.deepEqual((await (await call('/api/publications',null)).json()).items.map(item=>item.id).sort(),exploreBefore,'Publishing a profile does not create another Explore publication');
  assert.equal((await (await call('/api/publications/'+pubId,null)).json()).profileId,firstId);
  assert.equal((await (await call('/api/profile','other')).json()).profile,null);
  await expectStatus(await call('/api/profile','other',{method:'DELETE'}),200,'Another reader unpublishes only their own profile');
  assert.equal((await call('/api/profiles/'+firstId,null)).status,200);
  const profileImageUpload=new FormData();profileImageUpload.set('kind','image');
  profileImageUpload.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'profile-snapshot-spine.png',{type:'image/png'}));
  const profileImageId=(await (await expectStatus(await call('/api/assets','owner',{method:'POST',body:profileImageUpload}),201,'Upload profile-only spine image')).json()).id;
  state.books[0].spineUrl='/api/assets/'+profileImageId;await persist();
  await expectStatus(await publish(),200,'Publish a profile-only image snapshot');
  state.books[0].spineUrl='/api/assets/'+imageId;await persist();
  assert.equal((await call('/api/assets/'+profileImageId,'owner',{method:'DELETE'})).status,409,'A public profile keeps its artwork after private artwork changes');
  assert.equal((await call(`/api/profiles/${firstId}/assets/${profileImageId}`,null)).status,200);
  await expectStatus(await publish(),200,'Update the profile to release old artwork');
  await expectStatus(await call('/api/assets/'+profileImageId,'owner',{method:'DELETE'}),200,'Unused profile artwork can be deleted after updating the snapshot');
  publicProfile=await (await call('/api/profiles/'+firstId,null)).json();
  const before=JSON.stringify(publicProfile),stalePayload=payload();
  state.profile.bio='A changed bio, initially private';state.books[0].title='A privately changed title';
  await persist();
  assert.equal(JSON.stringify(await (await call('/api/profiles/'+firstId,null)).json()),before,'Editing the Library does not alter the public profile snapshot');
  assert.equal((await publish(stalePayload)).status,409,'A stale profile preview cannot publish another tab’s changed bio');
  const updated=await (await expectStatus(await publish(),200,'Update profile snapshot')).json();
  assert.equal(updated.profile.id,firstId);
  publicProfile=await (await call('/api/profiles/'+firstId,null)).json();
  assert.equal(publicProfile.bio,state.profile.bio);assert.equal(publicProfile.featured.books[0].title,state.books[0].title);
  await expectStatus(await call('/api/profile','owner',{method:'DELETE'}),200,'Unpublish profile');
  assert.equal((await call('/api/profiles/'+firstId,null)).status,404);
  assert.equal((await call(`/api/profiles/${firstId}/assets/${imageId}`,null)).status,404,'Unpublishing revokes profile image URLs');
  assert.equal((await (await call('/api/publications/'+pubId,null)).json()).profileId,undefined);
  assert.equal((await call('/api/publications/'+pubId,null)).status,200,'A separately shared shelf remains public');
  const temporary={...structuredClone(state.shelves[0]),id:'profile_temporary_shelf',title:'Temporary profile shelf'};
  state.shelves.push(temporary);state.profile.featuredShelfId=temporary.id;await persist();
  const temporaryProfile=await (await expectStatus(await publish(),201,'Republish a selected shelf')).json();
  assert.notEqual(temporaryProfile.profile.id,firstId,'Unpublished links cannot silently become public again');
  state.shelves=state.shelves.filter(shelf=>shelf.id!==temporary.id);delete state.profile.featuredShelfId;
  const [concurrentShare]=await Promise.all([
    call('/api/publications','owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shelfId:temporary.id})}),
    persist(),
  ]);
  assert.ok([200,201,404,409].includes(concurrentShare.status),'Publishing during shelf removal produces a guarded result');
  if(concurrentShare.ok){const shared=await concurrentShare.json();assert.equal((await call('/api/publications/'+shared.id,null)).status,404,'A concurrent publication cannot outlive its removed source shelf');}
  assert.equal((await (await call('/api/publications',null)).json()).items.some(item=>item.shelf.id===temporary.id),false);
  assert.equal((await call('/api/profiles/'+temporaryProfile.profile.id,null)).status,404,'Removing the featured shelf revokes its profile');
  state.profile.featuredShelfId='shelf1';await persist();
  const finalProfile=await (await expectStatus(await publish(),201,'Publish profile for shelf revocation check')).json();
  report('Featured profiles: private selection, separate snapshots, owner isolation, concurrent publishing, artwork protection and revocation');
  return {version,profileId:finalProfile.profile.id};
}
