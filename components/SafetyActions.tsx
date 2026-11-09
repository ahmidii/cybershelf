'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, ShieldMinus } from 'lucide-react';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { Modal } from './Dialogs';
import styles from './Safety.module.css';
type Kind = 'profile' | 'shelf' | 'post' | 'comment' | 'activity' | 'book';
type Context = { accountId: string; canReport: boolean; canBlock: boolean };
const reasons = [['harassment','Harassment or bullying'],['hate','Hateful content'],['sexual','Sexual content'],['violence','Threats or violence'],['spam','Spam or misleading activity'],['privacy','Personal information or privacy'],['copyright','Copyright concern'],['other','Something else']];
export default function SafetyActions({ kind, targetId }: { kind: Kind; targetId: string }) {
  const [open,setOpen]=useState(false),[context,setContext]=useState<Context|null>(null),[checking,setChecking]=useState(false),[needsSignIn,setNeedsSignIn]=useState(false);
  const [reason,setReason]=useState('harassment'),[details,setDetails]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmBlock,setConfirmBlock]=useState(false);
  const request=useRef<AbortController|null>(null);
  const close=useCallback(()=>{request.current?.abort();setOpen(false);setContext(null);setDetails('');setConfirmBlock(false);setError('');setNotice('');setBusy(false);},[]);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{close();},[close,kind,targetId]);
  async function show(){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setOpen(true);setChecking(true);setNeedsSignIn(false);setContext(null);setError('');setNotice('');
    try{const response=await fetch('/api/safety/target?kind='+kind+'&id='+encodeURIComponent(targetId),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(response.status===401){setNeedsSignIn(true);return;}
      const body=await response.json() as Context&{error?:string};if(!response.ok)throw new Error(body.error||'These controls are unavailable.');
      if(!controller.signal.aborted)setContext(body as Context);
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'These controls are unavailable.');}
    finally{if(!controller.signal.aborted)setChecking(false);}
  }
  async function submit(action:'report'|'block'){
    if(!context||busy)return;const controller=new AbortController();request.current=controller;setBusy(true);setError('');setNotice('');
    try{const response=await fetch(action==='report'?'/api/reports':'/api/blocks',{method:'POST',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),headers:{'Content-Type':'application/json',[ACCOUNT_ID_HEADER]:context.accountId},body:JSON.stringify({kind,targetId,...(action==='report'?{reason,details:details.trim()}:{})})});
      const result=await response.json() as {error?:string;code?:string};if(controller.signal.aborted)return;
      if(response.status===401||response.status===409&&result.code==='ACCOUNT_CHANGED'){setContext(null);setDetails('');setNeedsSignIn(true);throw new Error('Your account changed. Close this panel and sign in again.');}
      if(!response.ok)throw new Error(result.error||'This request could not be saved.');
      if(action==='block'){window.location.assign('/safety');return;}
      setDetails('');setConfirmBlock(false);setNotice(action==='report'?'Report received. Moderators can review it; the reported reader cannot see who submitted it.':'Reader blocked. Following connections were removed in both directions. Refresh this page to update visible conversations.');
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Please try again.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <div className={styles.tools}><button type="button" className={styles.trigger} onClick={()=>void show()} aria-label="Report content or block this reader"><Flag size={13}/>Report or block</button>{open&&<Modal title="A little care for this space." onClose={close}><div className={styles.body}>
    {checking?<p role="status">Checking your account…</p>:null}{error?<p className={`${styles.message} ${styles.error}`} role="alert">{error}</p>:null}{notice?<p className={styles.message} role="status">{notice}</p>:null}
    {needsSignIn?<><p>Sign in to report content or manage blocked readers.</p><a className="button primary" href={signInPath(window.location.pathname)}>Sign in</a></>:null}
    {context?.canReport?<form onSubmit={e=>{e.preventDefault();void submit('report');}}><h3>Report this {kind==='post'?'reading update':kind}.</h3><p>Tell moderators what needs attention. Include only information relevant to this public item; never include passwords or recovery keys.</p><label>Reason<select value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}>{reasons.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Anything else? <span>Optional · up to 2,000 characters</span><textarea value={details} onChange={e=>setDetails(e.target.value)} maxLength={2000} rows={4} disabled={busy}/></label><div className={styles.actions}><button className="button secondary" disabled={busy}>{busy?'Saving…':'Send report'}</button></div></form>:context?<p>This is your own content. You can edit or unshare it from your reading space.</p>:null}
    {context?.canBlock?<section><h3>Keep some distance.</h3><p>Blocking removes following connections, hides your content from each other’s signed-in views, and stops replies between you. Public pages can still be seen when signed out. Unblock a reader in Safety settings.</p>{confirmBlock?<div className={styles.actions}><button className="button danger" disabled={busy} onClick={()=>void submit('block')}>Block this reader</button><button className="button quiet" disabled={busy} onClick={()=>setConfirmBlock(false)}>Cancel</button></div>:<button className="button secondary" disabled={busy} onClick={()=>setConfirmBlock(true)}><ShieldMinus size={15}/>Block reader</button>}</section>:null}
    <a className="text-button" href="/safety">Safety &amp; blocked readers</a>
  </div></Modal>}</div>;
}
