import assert from 'node:assert/strict';

// The harness enables only this synthetic immutable ID as a moderator. This
// fixture never assumes the identity, password, or privileges of a real user.
const legacyHash='0123456789abcdef0123456789abcdef:57affd10380409758f367869d68e1ecc4cb021c67e86a84036865b67472cc4670c8f3e29134ea6f9cdac4cf3984ffde0790496df8ddfb62ed3969038fab719ba';
export async function runModerationIntegration({base,fetch:requestFetch,database,report=()=>{}}){
  const suffix=crypto.randomUUID().replaceAll('-','').slice(0,9),accounts=new Map();let address=1;
  const expect=async(response,status,label)=>{assert.equal(response.status,status,`${label}: ${response.status===status?'':await response.clone().text()}`);return response;};
  const call=(path,actor='reader',init={})=>{const user=actor?accounts.get(actor):null;return requestFetch(new URL(path,base).href,{...init,headers:{...(user?{Cookie:user.cookie,'X-Cybershelf-Account':user.id}:{}),...((init.method??'GET')==='GET'?{}:{Origin:base}),'cf-connecting-ip':`198.20.0.${address++}`,...init.headers}});};
  const post=(path,body,actor='reader',headers={})=>call(path,actor,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const cookie=r=>r.headers.getSetCookie().map(s=>s.split(';',1)[0]).join('; ');
  for(const actor of ['author','reader','bystander']){
    const response=await expect(await post('/api/auth/sign-up/username',{username:'safe_'+actor+'_'+suffix,password:'A quiet library beside the autumn river'},null),200,'Create moderation fixture account');
    const data=await response.json();accounts.set(actor,{id:data.user.id,cookie:cookie(response),username:data.user.username});
  }
  const now=Date.now(),moderatorEmail='moderator-fixture@example.invalid';
  await database.batch([
    database.prepare('INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('moderator_fixture','Local moderator',moderatorEmail,1,now,now),
    database.prepare('INSERT INTO auth_account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('moderator_credential','moderator_fixture','credential','moderator_fixture',legacyHash,now,now),
  ]);
  const signed=await expect(await post('/api/auth/sign-in/email',{email:moderatorEmail,password:'legacyPass12'},null),200,'Sign in as explicitly configured local moderator');accounts.set('moderator',{id:'moderator_fixture',cookie:cookie(signed)});
  const shelf={id:'safe_shelf',title:'A public shelf',description:'A deliberately shared description',bookcase:'open',layout:'balanced',finish:'paper',items:[{id:'safe_item',kind:'book',bookId:'safe_book',slot:0,pinned:false,facing:'spine'}],updatedAt:'2026-10-01T00:00:00.000Z'};
  const imageData=new FormData();imageData.set('kind','image');imageData.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'public-spine.png',{type:'image/png'}));
  const imageId=(await (await expect(await call('/api/assets','author',{method:'POST',body:imageData}),201,'Upload a local public-image fixture')).json()).id;
  for(const actor of ['author','reader','bystander']){
    const state={schemaVersion:1,profile:{name:'Safety '+actor,bio:'Public bio for '+actor,featuredShelfId:shelf.id},shelves:[structuredClone(shelf)],books:[{id:'safe_book',title:'A moderated reading fixture '+suffix,author:'Fixture Writer',color:'#879479',coverUrl:actor==='author'?'/api/assets/'+imageId:'',status:'reading',progress:50,pages:200,rating:null,review:'SAFETY_PRIVATE_REVIEW',notes:'SAFETY_PRIVATE_NOTES',sources:[],addedAt:shelf.updatedAt,readingLog:[{id:'safe_thought',body:'Public thought by '+actor,progress:20,createdAt:shelf.updatedAt},{id:'private_thought',body:'SAFETY_NEVER_SHARED',progress:30,createdAt:shelf.updatedAt}]}]};
    await expect(await call('/api/state',actor,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,version:0})}),200,'Save local safety library');
    accounts.get(actor).profileId=(await (await expect(await post('/api/profile',{shelfId:shelf.id,shelfUpdatedAt:shelf.updatedAt,name:state.profile.name,bio:state.profile.bio},actor),201,'Publish safety profile')).json()).profile.id;
    accounts.get(actor).postId=(await (await expect(await post('/api/journal',{bookId:'safe_book',entryId:'safe_thought'},actor),201,'Share safety reading update')).json()).post.id;
  }
  const author=accounts.get('author'),reader=accounts.get('reader'),bystander=accounts.get('bystander');
  const shelfId=(await (await expect(await post('/api/publications',{shelfId:shelf.id},'author'),201,'Publish safety shelf')).json()).id;
  const activityId=(await (await expect(await post('/api/activity',{kind:'added',bookId:'safe_book'},'author'),201,'Publish explicit book activity')).json()).item.id;
  const catalogId=(await (await expect(await post('/api/books/register',{bookId:'safe_book'},'author'),201,'Create reportable community metadata')).json()).id;
  await expect(await call('/api/books/'+catalogId+'/community/rating','author',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:4})}),200,'Publish a rating fixture');
  const authorReply=(await (await expect(await post('/api/journal/'+bystander.postId+'/comments',{body:'Public author reply on a third reader’s post',progress:20},'author'),201,'Create a reportable reply')).json()).comment.id;
  const anonymousProfileReply=(await (await expect(await post('/api/journal/'+reader.postId+'/comments',{body:'Public reply without a profile link',progress:20},'bystander'),201,'Create an unprofiled reply fixture')).json()).comment.id;
  await database.prepare('UPDATE reading_comments SET profile_id=NULL WHERE id=?').bind(anonymousProfileReply).run();
  for(const [follower,followed] of [['reader','author'],['author','reader'],['reader','bystander']])await expect(await post('/api/follows',{profileId:accounts.get(followed).profileId},follower),200,'Create following fixture');
  assert.equal((await call('/api/safety/me',null)).status,401);
  assert.equal((await (await call('/api/safety/me','reader')).json()).moderator,false);
  assert.equal((await (await call('/api/safety/me','moderator')).json()).moderator,true);
  assert.equal((await call('/api/moderation','reader')).status,403,'A regular account has no moderator queue access');
  assert.equal((await call('/api/moderation',null)).status,401);
  assert.equal((await post('/api/reports',{kind:'post',targetId:author.postId,reason:'spam'},null)).status,401);
  assert.equal((await post('/api/reports',{kind:'post',targetId:author.postId,reason:'spam',target_owner_id:reader.id})).status,400,'Client-supplied ownership is rejected');
  assert.equal((await post('/api/reports',{kind:'post',targetId:'private_thought',reason:'privacy'})).status,404,'Private library entries cannot be reported or looked up as public content');
  await expect(await post('/api/reports',{kind:'post',targetId:author.postId,reason:'harassment',details:'A private explanation for moderators.'}),202,'Report a canonical public post');
  await expect(await post('/api/reports',{kind:'post',targetId:author.postId,reason:'spam',details:'Duplicate report must not duplicate queue entries.'}),202,'Duplicate reporting is idempotent');
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM moderation_reports WHERE reporter_id=? AND target_id=?').bind(reader.id,author.postId).first()).n,1);
  let queue=await (await expect(await call('/api/moderation','moderator'),200,'Open moderator queue')).json();
  const postReport=queue.items.find(item=>item.targetId===author.postId);
  assert.ok(postReport);assert.equal(postReport.snapshot.body,'Public thought by author');assert.equal(postReport.details,'A private explanation for moderators.');
  for(const secret of ['SAFETY_PRIVATE_REVIEW','SAFETY_PRIVATE_NOTES','SAFETY_NEVER_SHARED',author.id,reader.id])assert.equal(JSON.stringify(queue).includes(secret),false,'Moderation queue excludes private data and auth identities: '+secret);
  assert.equal((await call('/api/moderation/'+postReport.id,'author')).status,403,'The reported reader cannot see the reporter or audit history');
  report('Reports resolve canonical public content, reject private/forged targets, deduplicate requests and keep reporter identities out of reader-facing responses');

  const initialFeed=await (await call('/api/feed')).json();assert.ok(initialFeed.items.some(item=>item.actor.id===author.profileId));
  await expect(await post('/api/blocks',{kind:'profile',targetId:author.profileId}),200,'Block a public reader');
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM follows WHERE (follower_id=? AND followed_owner_id=?) OR (follower_id=? AND followed_owner_id=?)').bind(reader.id,author.id,author.id,reader.id).first()).n,0,'Blocking removes follows in both directions');
  assert.equal((await post('/api/follows',{profileId:author.profileId})).status,404);
  assert.equal((await post('/api/follows',{profileId:reader.profileId},'author')).status,404);
  assert.equal((await post('/api/journal/'+author.postId+'/comments',{body:'Blocked reply',progress:20})).status,404);
  assert.equal((await post('/api/journal/'+reader.postId+'/comments',{body:'Reverse blocked reply',progress:20},'author')).status,404);
  for(const path of ['/api/profiles/'+author.profileId,'/api/profiles/'+author.profileId+'/journal','/api/publications/'+shelfId,'/api/journal/'+author.postId,'/api/publications/'+shelfId+'/assets/'+imageId]){
    assert.equal((await call(path)).status,404,'Signed-in blocked view is unavailable: '+path);
    assert.equal((await call(path,null)).status,200,'Public content remains public to signed-out visitors: '+path);
  }
  const feed=await (await call('/api/feed')).json();assert.equal(JSON.stringify(feed).includes('Public author reply'),false);assert.equal(feed.items.some(item=>item.actor.id===author.profileId),false);
  const thread=await (await call('/api/journal/'+bystander.postId)).json();assert.equal(thread.comments.some(item=>item.id===authorReply),false,'A blocked reader’s reply is withheld even on another reader’s post');
  const room=await (await call('/api/reading-room?bookId=safe_book')).json();assert.equal(room.items.some(item=>item.profileId===author.profileId),false);
  const blocks=await (await call('/api/blocks')).json();assert.equal(blocks.items.length,1);assert.equal(JSON.stringify(blocks).includes(author.id),false);
  const blockId=blocks.items[0].id;
  await expect(await call('/api/blocks/'+blockId,'author',{method:'DELETE'}),200,'Another reader cannot remove the block');assert.equal((await (await call('/api/blocks')).json()).items.length,1);
  await assert.rejects(database.prepare('INSERT INTO follows (follower_id,followed_owner_id,followed_profile_id,created_at) VALUES (?,?,?,?)').bind(author.id,reader.id,reader.profileId,new Date().toISOString()).run(),/READER_INTERACTION_UNAVAILABLE/,'Database trigger closes a follow/block race');
  await expect(await call('/api/blocks/'+blockId,'reader',{method:'DELETE'}),200,'Unblock own reader');
  await expect(await post('/api/blocks',{kind:'comment',targetId:anonymousProfileReply}),200,'A reader without a public profile link can still be blocked by a canonical reply');
  const otherBlock=(await (await call('/api/blocks')).json()).items[0].id;await expect(await call('/api/blocks/'+otherBlock,'reader',{method:'DELETE'}),200,'Remove the second fixture block');
  await expect(await post('/api/follows',{profileId:author.profileId}),200,'Following after unblock is an explicit choice');
  report('Reciprocal blocks stop follows/replies, filter signed-in public views, feeds and reading rooms, support unprofiled replies, and cannot be removed by the blocked account');

  const act=(id,action,actor='moderator',headers={})=>post('/api/moderation/'+id,{action,note:'A reviewed local moderation test decision.'},actor,headers);
  assert.equal((await act(postReport.id,'hide','reader')).status,403);
  assert.equal((await act(postReport.id,'hide','moderator',{'X-Cybershelf-Account':reader.id})).status,409);
  assert.equal((await act(postReport.id,'hide','moderator',{Origin:'https://attacker.invalid'})).status,403);
  await database.prepare('UPDATE auth_session SET created_at=? WHERE user_id=?').bind(Date.now()-16*60000,'moderator_fixture').run();
  const stale=await act(postReport.id,'hide');assert.equal(stale.status,403);assert.equal((await stale.json()).code,'FRESH_SESSION_REQUIRED');
  await database.prepare('UPDATE auth_session SET created_at=? WHERE user_id=?').bind(Date.now(),'moderator_fixture').run();
  await expect(await act(postReport.id,'hide'),200,'Hide a reported public update');
  assert.equal((await call('/api/journal/'+author.postId,null)).status,404);
  assert.equal((await call('/api/journal/'+author.postId+'/assets/'+imageId,null)).status,404);
  assert.equal((await (await call('/api/feed')).json()).items.some(item=>item.postId===author.postId),false);
  assert.equal((await (await call('/api/reading-room?bookId=safe_book')).json()).items.some(item=>item.id===author.postId),false);
  assert.equal((await call('/api/state','author')).status,200,'Hiding a public item never removes its private library');
  await expect(await act(postReport.id,'restore'),200,'Restore a public update after review');assert.equal((await call('/api/journal/'+author.postId,null)).status,200);
  const audit=await (await call('/api/moderation/'+postReport.id,'moderator')).json();assert.deepEqual(audit.actions.map(item=>item.action).sort(),['hide','restore']);assert.ok(audit.actions.every(item=>item.moderator_id==='moderator_fixture'&&item.note));
  report('Moderation fails closed for unconfigured readers, requires a fresh moderator session and same-account/origin checks, and hides/restores public text and image routes with an audit trail');

  await expect(await post('/api/reports',{kind:'comment',targetId:authorReply,reason:'spam'}),202,'Report a public reply');
  await expect(await post('/api/reports',{kind:'shelf',targetId:shelfId,reason:'privacy'},'bystander'),202,'Report a shelf');
  await expect(await post('/api/reports',{kind:'profile',targetId:author.profileId,reason:'other'},'bystander'),202,'Report a profile');
  await expect(await post('/api/reports',{kind:'activity',targetId:activityId,reason:'spam'},'bystander'),202,'Report book activity');
  await expect(await post('/api/reports',{kind:'book',targetId:catalogId,reason:'other'},'bystander'),202,'Report community bibliographic content');
  queue=await (await call('/api/moderation','moderator')).json();
  const findReport=targetId=>queue.items.find(item=>item.targetId===targetId)?.id;
  const commentReport=findReport(authorReply);assert.ok(commentReport);await expect(await act(commentReport,'hide'),200,'Hide a reply independently');
  assert.equal((await (await call('/api/journal/'+bystander.postId,null)).json()).comments.some(item=>item.id===authorReply),false);
  for(const [targetId,path] of [[shelfId,'/api/publications/'+shelfId],[author.profileId,'/api/profiles/'+author.profileId],[catalogId,'/api/books/'+catalogId]]){
    const id=findReport(targetId);assert.ok(id);await expect(await act(id,'hide'),200,'Hide supported public target');assert.equal((await call(path,null)).status,404);await expect(await act(id,'restore'),200,'Restore supported public target');assert.equal((await call(path,null)).status,200);
  }
  await expect(await act(findReport(activityId),'hide'),200,'Hide book announcement');assert.equal((await (await call('/api/feed')).json()).items.some(item=>item.id===activityId),false);
  await database.prepare("UPDATE reading_posts SET book_key='' WHERE id=?").bind(author.postId).run();
  await expect(await act(postReport.id,'suspend'),200,'Pause account participation');
  const ownStatus=await (await call('/api/safety/me','author')).json();assert.equal(ownStatus.suspended,true);
  for(const path of ['/api/profiles/'+author.profileId,'/api/publications/'+shelfId,'/api/journal/'+author.postId,'/api/publications/'+shelfId+'/assets/'+imageId])assert.equal((await call(path,null)).status,404,'Suspension hides public surface '+path);
  assert.equal((await call('/api/state','author')).status,200);assert.equal((await call('/account','author')).status,200,'Suspended readers keep account security and deletion access');
  assert.equal((await post('/api/publications',{shelfId:shelf.id},'author')).status,403);
  assert.equal((await post('/api/journal',{bookId:'safe_book',entryId:'safe_thought'},'author')).status,403);
  assert.equal((await post('/api/activity',{bookId:'safe_book',kind:'added'},'author')).status,403);
  assert.equal((await post('/api/follows',{profileId:reader.profileId},'author')).status,403);
  await expect(await call('/api/reading-room?bookId=safe_book'),200,'A suspended legacy post cannot block other readers’ conversation indexing');
  assert.equal((await (await call('/api/books/'+catalogId+'/community',null)).json()).stats.ratingCount,0,'Suspended contributions stop affecting public aggregates');
  await assert.rejects(database.prepare('UPDATE publications SET updated_at=? WHERE id=?').bind(new Date().toISOString(),shelfId).run(),/PUBLIC_PARTICIPATION_PAUSED/,'A stale publication write is stopped atomically');
  await expect(await act(postReport.id,'unsuspend'),200,'Restore account participation');assert.equal((await call('/api/profiles/'+author.profileId,null)).status,200);
  assert.equal((await (await call('/api/reading-room?bookId=safe_book')).json()).items.some(item=>item.id===author.postId),true,'Restored legacy posts are indexed and become readable again');
  assert.equal((await (await call('/api/journal/'+bystander.postId,null)).json()).comments.some(item=>item.id===authorReply),false,'Restoring an account does not restore separately hidden replies');
  assert.equal((await (await call('/api/books/'+catalogId+'/community',null)).json()).stats.ratingCount,1);
  report('All reportable public target types can be hidden; account suspension hides content and contributions while preserving private export/account access, with database enforcement against stale writes');

  let limited=false;for(let i=0;i<12&&!limited;i++){const response=await post('/api/reports',{kind:'post',targetId:author.postId,reason:'spam'});assert.ok([202,429].includes(response.status));limited=response.status===429;}assert.equal(limited,true,'Reports have durable per-account rate limits');
  assert.equal((await post('/api/reports',{kind:'post',targetId:author.postId,reason:'spam',details:'x'.repeat(2100)},'bystander')).status,400);
  assert.equal((await call('/api/moderation?cursor=bad-base64','moderator')).status,400);
  report('Reporting is bounded and durably throttled; malformed details and moderation cursors cannot bypass validation');
}
