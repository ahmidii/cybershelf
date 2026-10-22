'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StateResponse, emptyState, newShelf } from './types';
import { createDemoState } from './demo';
import { ACCOUNT_ID_HEADER } from './auth-contract';
import { adoptBrowserDraft, BROWSER_DRAFT_KEY, canRestoreBrowserDraft, removeSavedBrowserDraft } from './browser-draft';

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
  const importedDraft=useRef<string|null>(null);
  const restoringDraftRef=useRef(false);
  const [restoringDraft,setRestoringDraft]=useState(false);
  const [accountChanged,setAccountChanged]=useState(false);
  const accountChangedRef=useRef(false);
  const blocked=useRef(false);
  const load=useCallback(async()=>{
    setStatus('loading'); setError(''); readyRef.current=false; setReady(false); blocked.current=false;
    importedDraft.current=null;
    accountChangedRef.current=false;setAccountChanged(false);
    try {
      let draft:AppState|null=null;
      try { const raw=localStorage.getItem(BROWSER_DRAFT_KEY); if(raw){const data=JSON.parse(raw);if(data.schemaVersion===1&&Array.isArray(data.books)&&Array.isArray(data.shelves))draft=data;} }catch{}
      setHasDraft(!!draft);
      if(accountId){
        const response=await fetch('/api/state',{cache:'no-store',headers:{[ACCOUNT_ID_HEADER]:accountId},signal:AbortSignal.timeout(25000)});
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
    if(!accountId){try{localStorage.setItem(BROWSER_DRAFT_KEY,JSON.stringify(value));setStatus('local');}catch{setStatus('error');setError('This browser could not save your draft. Export a backup before closing.');}}
  },[accountId]);
  const flush=useCallback(async()=>{
    if(!accountId)return;
    const checkWritable=()=>{
      if(accountChangedRef.current)throw new Error(ACCOUNT_CHANGED_MESSAGE);
      if(!readyRef.current)throw new Error('Your library has not loaded yet.');
      if(blocked.current)throw new Error('A newer version was saved elsewhere. Export this draft, then reload.');
    };
    checkWritable();
    // Several actions may wait for the same save. Recheck the queue after
    // waking so only one of them starts the next revision.
    while(pending.current){await pending.current;checkWritable();}
    const run=async()=>{
      while(dirty.current){
        setStatus('saving');setError('');const snapshot=stateRef.current;
        try{
          const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json',[ACCOUNT_ID_HEADER]:accountId},body:JSON.stringify({state:snapshot,version:version.current}),signal:AbortSignal.timeout(25000)});
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
      if(importedDraft.current){
        try{if(removeSavedBrowserDraft(localStorage,importedDraft.current))setHasDraft(false);}catch{}
        // Failed saves never reach this point. Storage failures keep the local
        // copy, and a newer browser draft is never removed by this account.
        importedDraft.current=null;
      }
      setStatus('saved');
    };
    const task=run();pending.current=task;
    try{await task;}finally{if(pending.current===task)pending.current=null;}
  },[accountId]);
  useEffect(()=>{if(!ready||!accountId||!dirty.current||blocked.current)return;const timer=setTimeout(()=>{void flush().catch(()=>{});},850);return()=>clearTimeout(timer);},[state,ready,accountId,flush]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(accountId&&dirty.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[accountId]);
  const restoreDraft=async()=>{
    if(!accountId||!readyRef.current||accountChangedRef.current||blocked.current||restoringDraftRef.current)return false;
    restoringDraftRef.current=true;
    setRestoringDraft(true);setError('');
    try{
      const raw=localStorage.getItem(BROWSER_DRAFT_KEY);
      if(!raw){setHasDraft(false);return false;}
      const {parseCatalogJSON}=await import('./import');
      // Recheck after loading the parser: the reader may have changed accounts
      // or arranged their starter shelf while this module was loading.
      if(!readyRef.current||accountChangedRef.current||blocked.current)throw new Error(ACCOUNT_CHANGED_MESSAGE);
      const draft=adoptBrowserDraft(stateRef.current,parseCatalogJSON(raw));
      importedDraft.current=raw;update(draft);
      await flush();
      return true;
    }catch(reason){setError(reason instanceof Error?reason.message:'The browser draft could not be read.');return false;}
    finally{restoringDraftRef.current=false;setRestoringDraft(false);}
  };
  // Use only after the server confirms sign-out, including explicit discard.
  // Until then the unsaved draft remains available to export or retry.
  const finishSignOut=()=>{dirty.current=false;blocked.current=true;readyRef.current=false;importedDraft.current=null;};
  return {state,update,flush,status,error,ready,reload:load,hasDraft,restoreDraft,restoringDraft,canRestoreDraft:canRestoreBrowserDraft(state),finishSignOut,accountChanged};
}
