'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StateResponse, emptyState, newShelf } from './types';
import { createDemoState } from './demo';
import { ACCOUNT_ID_HEADER } from './auth-contract';

const DRAFT_KEY='cybershelf.browser-draft.v1';
const ACCOUNT_CHANGED_MESSAGE='Your account changed. Export this draft if needed, then reload to open the current account.';
export type SaveStatus='loading'|'demo'|'local'|'saving'|'saved'|'error'|'conflict';
export function useLibrary(accountId:string|null) {
  const [state,setState]=useState<AppState>(()=>createDemoState());
  const stateRef=useRef(state), version=useRef(0), dirty=useRef(false), readyRef=useRef(false);
  const pending=useRef<Promise<void>|null>(null);
  const [status,setStatus]=useState<SaveStatus>('loading');
  const [error,setError]=useState('');
  const [ready,setReady]=useState(false);
  const [hasDraft,setHasDraft]=useState(false);
  const [accountChanged,setAccountChanged]=useState(false);
  const accountChangedRef=useRef(false);
  const blocked=useRef(false);
  const load=useCallback(async()=>{
    setStatus('loading'); setError(''); readyRef.current=false; setReady(false); blocked.current=false;
    accountChangedRef.current=false;setAccountChanged(false);
    try {
      let draft:AppState|null=null;
      try { const raw=localStorage.getItem(DRAFT_KEY); if(raw){const data=JSON.parse(raw);if(data.schemaVersion===1&&Array.isArray(data.books)&&Array.isArray(data.shelves))draft=data;} }catch{}
      setHasDraft(!!draft);
      if(accountId){
        const response=await fetch('/api/state',{cache:'no-store',headers:{[ACCOUNT_ID_HEADER]:accountId}});
        const result=await response.json() as StateResponse & {error?:string;code?:string};
        if(response.status===401||result.code==='ACCOUNT_CHANGED'||(response.ok&&result.user?.id!==accountId)){
          accountChangedRef.current=true;setAccountChanged(true);blocked.current=true;
          throw new Error(ACCOUNT_CHANGED_MESSAGE);
        }
        if(!response.ok)throw new Error(result.error||'Your library could not be loaded.');
        const initial:AppState=result.state||{...emptyState(),profile:{name:(result.user?.name||'Reader').slice(0,80),bio:''},shelves:[newShelf()]};
        stateRef.current=initial; setState(initial);version.current=result.version; dirty.current=!result.state;setStatus('saved');
      }else{
        const initial=draft||createDemoState();stateRef.current=initial;setState(initial);dirty.current=false;setStatus(draft?'local':'demo');
      }
      readyRef.current=true;setReady(true);
    }catch(e){setError(e instanceof Error?e.message:'Could not load your library.');setStatus('error');}
  },[accountId]);
  useEffect(()=>{void load();},[load]);
  const update=useCallback((next:AppState|((current:AppState)=>AppState))=>{
    if(!readyRef.current)return;
    const value=typeof next==='function'?next(stateRef.current):next;
    stateRef.current=value;setState(value);dirty.current=true;
    if(!accountId){try{localStorage.setItem(DRAFT_KEY,JSON.stringify(value));setStatus('local');}catch{setStatus('error');setError('This browser could not save your draft. Export a backup before closing.');}}
  },[accountId]);
  const flush=useCallback(async()=>{
    if(!accountId)return;
    if(accountChangedRef.current)throw new Error(ACCOUNT_CHANGED_MESSAGE);
    if(!readyRef.current)throw new Error('Your library has not loaded yet.');
    if(blocked.current)throw new Error('A newer version was saved elsewhere. Export this draft, then reload.');
    if(pending.current)await pending.current;
    const run=async()=>{
      while(dirty.current){
        setStatus('saving');setError('');const snapshot=stateRef.current;
        try{
          const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json',[ACCOUNT_ID_HEADER]:accountId},body:JSON.stringify({state:snapshot,version:version.current})});
          const result=await response.json() as {version:number;error?:string;code?:string};
          if(response.status===401||result.code==='ACCOUNT_CHANGED'){
            accountChangedRef.current=true;setAccountChanged(true);blocked.current=true;
            readyRef.current=false;setReady(false);setStatus('error');
            throw new Error(ACCOUNT_CHANGED_MESSAGE);
          }
          if(response.status===409){blocked.current=true;setStatus('conflict');throw new Error('Your library changed in another tab. Export this draft before reloading to keep both versions.');}
          if(!response.ok)throw new Error(result.error||'Could not save changes.');
          version.current=result.version;
          if(stateRef.current===snapshot)dirty.current=false;
        }catch(e){if(!blocked.current)setStatus('error');setError(e instanceof Error?e.message:'Could not save changes.');throw e;}
      }
      setStatus('saved');
    };
    pending.current=run();
    try{await pending.current;}finally{pending.current=null;}
  },[accountId]);
  useEffect(()=>{if(!ready||!accountId||!dirty.current||blocked.current)return;const timer=setTimeout(()=>{void flush().catch(()=>{});},850);return()=>clearTimeout(timer);},[state,ready,accountId,flush]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(accountId&&dirty.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[accountId]);
  const restoreDraft=()=>{try{const raw=localStorage.getItem(DRAFT_KEY);if(raw)update(JSON.parse(raw));}catch{setError('The browser draft could not be read.');}};
  return {state,update,flush,status,error,ready,reload:load,hasDraft,restoreDraft,accountChanged};
}
