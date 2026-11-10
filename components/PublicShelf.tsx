'use client';

import SafetyActions from './SafetyActions';
import { useEffect, useState } from 'react';
import ShelfCanvas from './ShelfCanvas';
import BrandMark from './BrandMark';
import BrandWordmark from './BrandWordmark';
import { emptyState, newBook, uid, type AppState, type Book, type Publication, type PublicBook, type Shelf, type ShelfItem, type StateResponse } from '../lib/types';
import styles from './PublicShelf.module.css';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { copyShelfItems } from '@/lib/shelf-actions';
import { normalizeCatalogId } from '@/lib/book-catalog';
import CommunityAssetDetails from './CommunityAssetDetails';
import { Modal } from './Dialogs';

class SignInRequired extends Error {}
const sameBook=(book:Book,other:PublicBook)=>!(book.catalogId&&other.catalogId&&book.catalogId!==other.catalogId)&&!(book.editionId&&other.editionId&&book.editionId!==other.editionId)&&book.title.trim().toLocaleLowerCase()===other.title.trim().toLocaleLowerCase()&&book.author.trim().toLocaleLowerCase()===other.author.trim().toLocaleLowerCase();
const importBook=(book:PublicBook):Book=>({...newBook(book.title,book.author),coverUrl:book.coverUrl,color:book.color, ...(book.catalogId?{catalogId:book.catalogId}:{}), ...(book.editionId?{editionId:book.editionId}:{}), ...(book.pages!==undefined?{pages:book.pages}:{}), ...(book.format?{format:book.format}:{}), ...(book.dimensions?{dimensions:{...book.dimensions}}:{}), ...(book.spineUrl?{spineUrl:book.spineUrl}:{}),...(book.spineAssetId?{spineAssetId:book.spineAssetId,spineMode:'custom' as const}:{}),...(book.coverAssetId?{coverAssetId:book.coverAssetId}:{})});

function PublicCover({book,detail=false}:{book:PublicBook;detail?:boolean}) {
  const [failed,setFailed]=useState(false);
  return <span className={detail?styles.detailCover:styles.miniCover} style={{background:book.color}}>
    {book.coverUrl&&!failed?<img src={book.coverUrl} alt={detail?`Cover of ${book.title}`:''} loading="lazy" onError={()=>setFailed(true)}/>:<><BrandMark/>{detail?<strong>{book.title}</strong>:null}</>}
  </span>;
}

async function updateLibrary(change:(state:AppState)=>{state:AppState;message:string}):Promise<string> {
  let expectedAccount:string|undefined;
  for(let attempt=0;attempt<2;attempt++) {
    const response=await fetch('/api/state',{cache:'no-store',headers:expectedAccount?{[ACCOUNT_ID_HEADER]:expectedAccount}:undefined});
    if(response.status===401)throw new SignInRequired('Sign in to save this to your library.');
    if(!response.ok){const error=await response.json().catch(()=>({})) as {error?:string};throw new Error(error.error||'Your library could not be opened. Please try again.');}
    const current=await response.json() as StateResponse;
    if(!current.user?.id||(expectedAccount&&current.user.id!==expectedAccount))throw new Error('Your account changed. Reload the page before saving this to your library.');
    expectedAccount=current.user.id;
    const next=change(current.state||emptyState());
    const saved=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json',[ACCOUNT_ID_HEADER]:expectedAccount},body:JSON.stringify({state:next.state,version:current.version})});
    if(saved.status===401)throw new SignInRequired('Sign in to save this to your library.');
    if(!saved.ok){
      const error=await saved.json().catch(()=>({})) as {error?:string;code?:string};
      if(saved.status===409&&error.code!=='ACCOUNT_CHANGED'&&attempt===0)continue;
      throw new Error(error.error||'Your library could not be saved. Please try again.');
    }
    return next.message;
  }
  throw new Error('Your library changed in another tab. Please try again.');
}

export default function PublicShelf({id,accountId=null}:{id:string;accountId?:string|null}) {
  const [publication,setPublication]=useState<Publication|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<PublicBook|null>(null);
  const [selectedAsset,setSelectedAsset]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [needsSignIn,setNeedsSignIn]=useState(false);
  const [copiedShelf,setCopiedShelf]=useState(false);
  const signInUrl=signInPath('/s/'+id);
  function openBook(book:PublicBook|null) {setNotice('');setNeedsSignIn(false);setSelected(book);}

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    fetch('/api/publications/'+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{
      if(response.status===404||response.status===410)throw new Error('This shelf is taking a little time to itself. Its owner may have made it private or removed the link.');
      if(!response.ok)throw new Error('We couldn’t open this shelf just now. Please try again in a moment.');
      setPublication(await response.json() as Publication);
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'This shelf could not be loaded.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[id]);

  async function saveBook(book:PublicBook) {
    setBusy(true);setNotice('');setNeedsSignIn(false);
    try {
      setNotice(await updateLibrary(state=>{
        if(state.books.some(owned=>sameBook(owned,book)))return {state,message:`“${book.title}” is already in your library.`};
        return {state:{...state,books:[...state.books,importBook(book)]},message:`“${book.title}” was added to your library.`};
      }));
    }catch(reason){if(reason instanceof SignInRequired)setNeedsSignIn(true);else setNotice(reason instanceof Error?reason.message:'The book could not be saved.');}
    finally{setBusy(false);}
  }
  async function copyShelf() {
    if(!publication)return;
    setBusy(true);setNotice('');setNeedsSignIn(false);
    try {
      setNotice(await updateLibrary(state=>{
        const books=[...state.books];
        const bookIds=new Map<string,string>();
        for(const book of publication.books){
          const existing=books.find(candidate=>sameBook(candidate,book));
          if(existing){bookIds.set(book.id,existing.id);continue;}
          const imported=importBook(book);books.push(imported);bookIds.set(book.id,imported.id);
        }
        const shelf:Shelf={
          ...publication.shelf,id:uid('sh_'),title:publication.shelf.title.slice(0,130)+' — my version',publicId:undefined,updatedAt:new Date().toISOString(),
          items:copyShelfItems(publication.shelf.items.flatMap<ShelfItem>(item=>{
            if(item.kind==='book')return bookIds.has(item.bookId!)?[{...item,bookId:bookIds.get(item.bookId!),pinned:false}]:[];
            // Deliberately contributed catalogue images are reusable; an
            // unrelated reader's personal upload never becomes a shared asset.
            if(item.decor==='image')return item.sharedAssetId?[{...item,assetId:undefined,pinned:false}]:[];
            return [{...item,assetId:undefined,imageUrl:undefined,pinned:false}];
          }),()=>uid('it_')),
        };
        return {state:{...state,books,shelves:[...state.shelves,shelf]},message:'Your version is ready. Make it your own in Shelves.'};
      }));
      setCopiedShelf(true);
    }catch(reason){if(reason instanceof SignInRequired)setNeedsSignIn(true);else setNotice(reason instanceof Error?reason.message:'The shelf could not be copied.');}
    finally{setBusy(false);}
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <a href="/" className={styles.logo} aria-label="Cybershelf home"><BrandWordmark/><span className={styles.beta}>BETA</span></a>
      <a className={styles.headerLink} href="/">A shelf of your own <span aria-hidden="true">↗</span></a>
    </header>
    <main className={styles.main}>
      {loading?<section className={styles.loading} aria-busy="true" aria-label="Loading shared shelf"><div className={styles.loadingMark}><BrandMark/></div><p>Finding your place on the shelf…</p></section>:error?<section className={styles.emptyState}>
        <span className={styles.eyebrow}>A QUIET CORNER</span><h1>Shelf unavailable</h1><p>{error}</p><a className={styles.primary} href="/">Explore cybershelf <span aria-hidden="true">↗</span></a>
      </section>:publication?<>
        <section className={styles.intro}>
          <span className={styles.eyebrow}><span className={styles.ownerDot} aria-hidden="true"/> ON {publication.name.toLocaleUpperCase()}’S SHELF</span>
          <h1>{publication.shelf.title}</h1><SafetyActions kind="shelf" targetId={publication.id}/>{publication.profileId&&<a className={styles.ownerLink} href={'/u/'+publication.profileId}>Visit {publication.name}’s profile <span aria-hidden="true">↗</span></a>}
          {publication.shelf.description?<p className={styles.description}>{publication.shelf.description}</p>:null}
          <div className={styles.meta}><span>{publication.bookCount} {publication.bookCount===1?'BOOK':'BOOKS'}</span><span aria-hidden="true">/</span><span>A LITTLE WORLD, SHARED</span></div>
        </section>
        <section className={styles.display} aria-label="Shared bookshelf"><ShelfCanvas shelf={publication.shelf} books={publication.books} onBookOpen={bookId=>openBook(publication.books.find(book=>book.id===bookId)||null)} onDecorOpen={item=>{if(item.sharedAssetId)setSelectedAsset(item.sharedAssetId);}}/></section>
        <div className={styles.belowShelf}><p>Every shelf tells a story. Pick a book to begin.</p><BrandMark/></div>
        <section className={styles.copySection}>
          <div><h2>A little inspiration for your own shelf.</h2><p>Keep the books and arrangement. Bring your own personality.</p></div>
          {copiedShelf?<a href="/" className={styles.primary}>Open my shelves <span aria-hidden="true">↗</span></a>:<button type="button" className={styles.primary} disabled={busy} onClick={copyShelf}>{busy?'Saving…':'Make a shelf like this'}<span aria-hidden="true">↗</span></button>}
          <small>Copies the books, shelf style, and reusable catalogue decorations with their credits. Personal decorations stay with their owner.</small>
        </section>
        {(notice||needsSignIn)?<section className={styles.feedback} aria-live="polite">
          {notice?<p role="status">{notice}</p>:null}
          {needsSignIn?<><p>Sign in to add books and save your own shelves.</p><a href={signInUrl} className={styles.primary}>Sign in to cybershelf <span aria-hidden="true">↗</span></a></>:null}
        </section>:null}
        {publication.books.length?<section className={styles.bookList}>
          <div className={styles.sectionHeading}><h2>Between these covers</h2><span>{publication.books.length.toString().padStart(2,'0')} TITLES</span></div>
          <div className={styles.bookGrid}>{publication.books.map((book,index)=><button type="button" key={book.id} className={styles.bookRow} onClick={()=>openBook(book)}><span className={styles.bookIndex}>{(index+1).toString().padStart(2,'0')}</span><PublicCover book={book}/><span className={styles.bookWords}><strong>{book.title}</strong><small>{book.author}</small></span><span className={styles.bookArrow} aria-hidden="true">↗</span></button>)}</div>
        </section>:null}
      </>:null}
    </main>
    <footer className={styles.footer}><a href="/" className={styles.footerLogo}><BrandWordmark/></a><p>Your books. Your little corner of the internet.</p><span>MADE FOR KEEPING</span></footer>
    {selected?<Modal title="Found on a shelf." onClose={()=>setSelected(null)}><div className={styles.dialogBody}>
        <span className={styles.eyebrow}>FOUND ON A SHELF</span>
        <PublicCover key={selected.id} book={selected} detail/>
        <h2 id="public-book-title">{selected.title}</h2><p className={styles.author}>{selected.author}</p>
        {(selected.spineAssetId||selected.coverAssetId)?<div className="button-row">{selected.spineAssetId?<button type="button" className="text-button" onClick={()=>setSelectedAsset(selected.spineAssetId!)}>Spine artwork &amp; credit</button>:null}{selected.coverAssetId?<button type="button" className="text-button" onClick={()=>setSelectedAsset(selected.coverAssetId!)}>Cover artwork &amp; credit</button>:null}</div>:null}
        <p className={styles.detailNote}>Save this title to your library, then find a place for it on your own shelf.</p>
        <a className={styles.primary} href={normalizeCatalogId(selected.catalogId)?'/books/'+selected.catalogId:'/books?q='+encodeURIComponent(selected.title+' '+selected.author)}>Book page & editions <span aria-hidden="true">↗</span></a>
        <button type="button" className={styles.primary} onClick={()=>saveBook(selected)} disabled={busy}>{busy?'Saving…':'+ Add to my library'}</button>
        {notice?<p className={styles.dialogNotice} role="status">{notice}</p>:null}
        {needsSignIn?<div className={styles.dialogNotice}><p>Sign in to save this book.</p><a href={signInUrl}>Sign in to cybershelf ↗</a></div>:null}
      </div></Modal>:null}
    {selectedAsset?<CommunityAssetDetails assetId={selectedAsset} accountId={accountId} onClose={()=>setSelectedAsset(null)}/>:null}
  </div>;
}
