'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ShieldCheck } from 'lucide-react';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import styles from './Safety.module.css';
type Item={id:string;name:string;profileId:string|null;createdAt:string};
export default function SafetySettings({accountId}:{accountId:string}){
  const [items,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [status,setStatus]=useState<{suspended:boolean;message:string|null;moderator:boolean}|null>(null);
  const active=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    active.current?.abort();const controller=new AbortController();active.current=controller;
    setLoading(true);setError('');setStatus(null);setItems([]);
    try{const headers={[ACCOUNT_ID_HEADER]:accountId};const responses=await Promise.all([fetch('/api/safety/me',{headers,cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),fetch('/api/blocks',{headers,cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})]);
      for(const response of responses)if(!response.ok){const e=await response.json() as {error?:string};throw new Error(e.error||'Sign in again to open safety settings.');}
      const [me,blocks]=await Promise.all(responses.map(r=>r.json())) as [{suspended:boolean;message:string|null;moderator:boolean},{items:Item[]}];if(!controller.signal.aborted){setStatus(me);setItems(blocks.items);}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Safety settings are unavailable.');}finally{if(!controller.signal.aborted)setLoading(false);}
  },[accountId]);
  useEffect(()=>{void refresh();const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);return()=>{active.current?.abort();window.removeEventListener('focus',onFocus);};},[refresh]);
  async function unblock(id:string){if(busy)return;setBusy(id);setNotice('');setError('');try{const response=await fetch('/api/blocks/'+encodeURIComponent(id),{method:'DELETE',headers:{[ACCOUNT_ID_HEADER]:accountId},signal:AbortSignal.timeout(15000)});if(!response.ok){const e=await response.json() as {error?:string};throw new Error(e.error||'This block could not be removed.');}setItems(current=>current.filter(item=>item.id!==id));setNotice('Reader unblocked. Following connections are not restored automatically.');}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy('');}}
  return <><p className="eyebrow">A LITTLE CARE FOR YOUR READING LIFE</p><h1 className={styles.heading}>Safety &amp; blocked readers.</h1><p className={styles.description}>Choose who you read alongside, report public content that needs attention, and keep control of your account.</p>
    {error?<p className={`${styles.message} ${styles.error}`} role="alert">{error}</p>:null}{notice?<p className={styles.message} role="status">{notice}</p>:null}
    {loading?<p role="status" className={styles.description}>Checking your account…</p>:status?<>
      {status.suspended?<section className={`${styles.card} ${styles.notice}`}><h2>Public participation is paused.</h2><p>{status.message} Your private library, exports, account security, and account deletion remain available. Your public content is hidden while this pause is active.</p></section>:<p className={styles.description}><ShieldCheck size={15}/> Your account can participate in the community.</p>}
      <section className={styles.card}><h2>Blocked readers.</h2><p>Blocking removes following connections in both directions and stops direct replies. Your content is hidden from each other’s signed-in views, including Reading together. Public pages can still be viewed when signed out. Blocking does not send a notification.</p>
        {items.length?<div className={styles.list}>{items.map(item=><div className={styles.person} key={item.id}><strong>{item.name}</strong><button className="button secondary small" disabled={!!busy} onClick={()=>void unblock(item.id)}>{busy===item.id?'Removing…':'Unblock'}</button></div>)}</div>:<p>You have no blocked readers.</p>}
      </section>
      <section className={styles.card}><h2>Report something that needs attention.</h2><p>Use “Report or block” on a public shelf, profile, reading update, reply, or community book page. A report goes to configured moderators. The reported reader cannot see who submitted it. Reports are reviewed by people; submitting one does not automatically remove content.</p><p>Moderators can hide a public item or pause an account’s public participation. They do not need access to private libraries, passwords, or recovery keys to review a report.</p></section>
      <details className={styles.card}><summary>Account identifier</summary><p>This identifies your account for support and moderator setup. It does not grant account access.</p><p className={styles.id}>{accountId}</p><button type="button" className="button secondary small" onClick={async()=>{try{await navigator.clipboard.writeText(accountId);setNotice('Account identifier copied.');}catch{setError('Copy the identifier shown above.');}}}><Copy size={14}/>Copy account ID</button></details>
      {status.moderator?<a className="button secondary" href="/moderation">Open moderation queue</a>:null}
    </>:null}<nav className={styles.nav}><a href="/account">Account &amp; security</a><a href="/privacy">Privacy and your data</a><a href="/">Your reading space</a></nav>
  </>;
}
