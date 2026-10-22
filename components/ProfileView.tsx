'use client';

import { useCallback,useEffect,useState } from 'react';
import { ArrowUpRight,Check,Copy,Globe,LoaderCircle,LockKeyhole,PenLine,Star } from 'lucide-react';
import type { AppState } from '@/lib/types';
import { ACCOUNT_ID_HEADER,signInPath } from '@/lib/auth-contract';
import ShelfCanvas from './ShelfCanvas';
import styles from './Profile.module.css';

type PublishedProfile={id:string;shelfId:string;name:string;bio:string;publishedAt:string;updatedAt:string};
interface ProfileViewProps {
  state:AppState;accountId:string|null;ready:boolean;
  update:(updater:(current:AppState)=>AppState)=>void;flush:()=>Promise<void>;
  notify:(message:string)=>void;onOpenShelf:(id:string)=>void;
}

export default function ProfileView({state,accountId,ready,update,flush,notify,onOpenShelf}:ProfileViewProps){
  const [published,setPublished]=useState<PublishedProfile|null>(null),[publicUrl,setPublicUrl]=useState('');
  const [loading,setLoading]=useState(!!accountId),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState('');
  const [name,setName]=useState(state.profile.name),[copied,setCopied]=useState(false);
  const shelf=state.shelves.find(candidate=>candidate.id===state.profile.featuredShelfId);
  useEffect(()=>setName(state.profile.name),[state.profile.name]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setPublished(null);setPublicUrl('');setLoadError('');
    if(!accountId){setLoading(false);return;}
    setLoading(true);
    try{
      const response=await fetch('/api/profile',{cache:'no-store',signal,headers:{[ACCOUNT_ID_HEADER]:accountId}});
      const result=await response.json() as {profile:PublishedProfile|null;url?:string;error?:string};
      if(!response.ok)throw new Error(result.error||'Your published profile could not be checked.');
      setPublished(result.profile);setPublicUrl(result.url?new URL(result.url,window.location.origin).href:'');
    }catch(reason){if(!signal?.aborted)setLoadError(reason instanceof Error?reason.message:'Your profile could not be checked.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[accountId]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const saveName=()=>{const next=name.trim()||state.profile.name;setName(next);update(current=>({...current,profile:{...current.profile,name:next}}));return next;};
  async function publish(){
    if(!accountId||!shelf)return;
    setBusy(true);setError('');
    const reviewedName=saveName();
    try{
      await flush();
      const response=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json',[ACCOUNT_ID_HEADER]:accountId},body:JSON.stringify({shelfId:shelf.id,name:reviewedName,bio:state.profile.bio,shelfUpdatedAt:shelf.updatedAt})});
      const result=await response.json() as {profile:PublishedProfile;url:string;error?:string};
      if(!response.ok)throw new Error(result.error||'Your profile could not be published.');
      setPublished(result.profile);setPublicUrl(new URL(result.url,window.location.origin).href);setCopied(false);
      notify(published?'Your public profile has been updated.':'Your featured shelf has a home on your profile.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Your profile could not be published.');}
    finally{setBusy(false);}
  }
  async function unpublish(){
    if(!accountId)return;setBusy(true);setError('');
    try{
      const response=await fetch('/api/profile',{method:'DELETE',headers:{[ACCOUNT_ID_HEADER]:accountId}});
      if(!response.ok){const result=await response.json() as {error?:string};throw new Error(result.error||'Your profile could not be made private.');}
      setPublished(null);setPublicUrl('');notify('Your profile and its shared reading activity are now hidden.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Please try again.');}
    finally{setBusy(false);}
  }
  async function copyLink(){try{await navigator.clipboard.writeText(publicUrl);setCopied(true);notify('Profile link copied.');}catch{setError('Select the profile link below and copy it.');}}
  return <section className={styles.ownerView}>
    <div className="page-heading"><div><p className="eyebrow">Your profile</p><h1>Your shelf, your signature.</h1><p className="page-description">One little world to introduce your reading life.</p></div><span className={styles.visibility}>{loading?<LoaderCircle size={14} className="spin"/>:published?<Globe size={14}/>:<LockKeyhole size={14}/>} {loading?'Checking profile':loadError?'Status unavailable':published?'Public snapshot':'Private preview'}</span></div>
    <div className={styles.editorGrid}>
      <div className={styles.preview}>
        <header className={styles.identity}><span className={styles.avatar} aria-hidden="true">{(name.trim()||state.profile.name).slice(0,1).toLocaleUpperCase()}</span><div><p className={styles.kicker}>A reader on cybershelf</p><h2>{name.trim()||state.profile.name}</h2>{state.profile.bio?<p className={styles.bio}>{state.profile.bio}</p>:<p className={styles.placeholder}>A few words about the worlds you keep.</p>}</div></header>
        {shelf?<><div className={styles.featureHeading}><div><span className={styles.featureLabel}><Star size={12}/>Featured shelf</span><h3>{shelf.title}</h3>{shelf.description?<p>{shelf.description}</p>:null}</div><button className="text-button" type="button" onClick={()=>onOpenShelf(shelf.id)}><PenLine size={13}/>Arrange</button></div><div className={styles.shelfFrame}><ShelfCanvas shelf={shelf} books={state.books} compact/></div><p className={styles.previewNote}>Your featured shelf. Reading updates appear separately when you choose to share them.</p></>:<div className={styles.emptyFeature}><Star size={30} strokeWidth={1.2}/><h3>Which shelf feels like you?</h3><p>Choose a shelf to make it the centrepiece of your profile. Your choice stays private until you publish.</p></div>}
      </div>
      <aside className={styles.controls} aria-label="Profile settings">
        <fieldset disabled={busy||!ready}>
          <h2>Make yourself at home</h2>
          <label className="field">Display name<input value={name} maxLength={80} onChange={event=>setName(event.target.value)} onBlur={saveName}/></label>
          <label className="field">About your reading life<textarea value={state.profile.bio} maxLength={1000} rows={4} onChange={event=>update(current=>({...current,profile:{...current.profile,bio:event.target.value}}))} placeholder="The books you return to. The worlds you get lost in."/></label>
          <label className="field">Featured shelf<select value={state.profile.featuredShelfId??''} onChange={event=>{const id=event.target.value;update(current=>({...current,profile:{...current.profile,featuredShelfId:id||undefined}}));}}><option value="">Choose one of your shelves</option>{state.shelves.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label>
          {!state.shelves.length?<p className={styles.help}>Make a shelf first, then choose it here.</p>:<p className={styles.help}>You can change your featured shelf whenever you like.</p>}
        </fieldset>
        <div className={styles.publishPanel}>
          <h3>{published?'Your public profile':'Ready to share your corner?'}</h3>
          <p>Publishing shares your display name, bio, and the visible books and decorations on your chosen shelf.</p>
          <p className={styles.privacy}><LockKeyhole size={13}/>This publishes your featured shelf, name, and bio. Your files, source links, locations, and private notes stay private. Share individual reading updates from your journal when you want company.</p>
          {loadError?<div className="notice error" role="alert"><p>{loadError}</p><button className="text-button" onClick={()=>void load()}>Check again</button></div>:accountId?<button className="button primary full" disabled={!shelf||!ready||busy||loading} onClick={()=>void publish()}>{busy?<LoaderCircle size={15} className="spin"/>:<Globe size={15}/>} {published?'Update public profile':'Publish profile'}</button>:<a href={signInPath()} className="button primary full">Sign in to publish <ArrowUpRight size={15}/></a>}
          {published&&<><p className={styles.snapshotNote}>Your published version stays the same until you update it. It is separate from shelves you share in Explore.</p><div className={styles.shareLink}><input value={publicUrl} readOnly aria-label="Your public profile link" onFocus={event=>event.target.select()}/><button type="button" className="icon-button" aria-label="Copy profile link" onClick={()=>void copyLink()}>{copied?<Check size={16}/>:<Copy size={16}/>}</button><a href={publicUrl} target="_blank" rel="noreferrer" className="icon-button" aria-label="View public profile"><ArrowUpRight size={16}/></a></div><button type="button" className="text-button danger-text" disabled={busy} onClick={()=>void unpublish()}>Unpublish profile</button><p className={styles.snapshotNote}>Unpublishing hides your profile, shared journal entries, and profile-linked feed activity. Separately shared shelves stay published until you unpublish them in Share.</p></>}
          {error&&<p className="notice error" role="alert">{error}</p>}
        </div>
      </aside>
    </div>
  </section>;
}
