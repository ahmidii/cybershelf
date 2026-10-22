'use client';

import { useEffect,useState } from 'react';
import { ArrowUpRight,Copy,LoaderCircle,Star } from 'lucide-react';
import type { PublicBook,PublicProfile as Profile } from '@/lib/types';
import ShelfCanvas from './ShelfCanvas';
import BookCover from './BookCover';
import BrandWordmark from './BrandWordmark';
import FollowButton from './FollowButton';
import ProfileJournal from './ProfileJournal';
import { Modal } from './Dialogs';
import styles from './Profile.module.css';

export default function PublicProfile({id}:{id:string}){
  const [profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [selected,setSelected]=useState<PublicBook|null>(null),[copied,setCopied]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setProfile(null);setSelected(null);setCopied(false);
    fetch('/api/profiles/'+encodeURIComponent(id),{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(response.status===404)throw new Error('This reader is keeping their corner private, or has removed this link.');
      if(!response.ok)throw new Error('This profile could not be opened just now. Please try again.');
      const result=await response.json() as Profile;if(!controller.signal.aborted)setProfile(result);
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'This profile could not be opened.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[id]);
  const openBook=(book:PublicBook|null)=>{setSelected(book);setCopied(false);};
  return <div className={styles.publicPage}>
    <header className={styles.publicHeader}><a href="/" className={styles.brand} aria-label="Cybershelf home"><BrandWordmark/></a><a href="/" className={styles.homeLink}>Make yourself a shelf <ArrowUpRight size={16}/></a></header>
    <main className={styles.publicMain}>
      {loading?<div className={styles.pageState} aria-busy="true"><LoaderCircle size={26} className="spin"/><p>Opening a reader’s corner…</p></div>:error?<div className={styles.pageState}><h1>Profile unavailable</h1><p>{error}</p><a href="/" className="button primary">Explore cybershelf <ArrowUpRight size={15}/></a></div>:profile?<>
        <header className={`${styles.identity} ${styles.publicIdentity}`}><span className={styles.avatar} aria-hidden="true">{profile.name.slice(0,1).toLocaleUpperCase()}</span><div><p className={styles.kicker}>A reader on cybershelf</p><h1>{profile.name}</h1>{profile.bio?<p className={styles.bio}>{profile.bio}</p>:null}</div><FollowButton profileId={profile.id} className={styles.publicFollow}/></header>
        <section className={styles.publicFeature} aria-label="Featured shelf">
          <div className={styles.featureHeading}><div><span className={styles.featureLabel}><Star size={13}/>Featured shelf</span><h2>{profile.featured.shelf.title}</h2>{profile.featured.shelf.description?<p>{profile.featured.shelf.description}</p>:null}</div><span className={styles.bookCount}>{profile.featured.bookCount} {profile.featured.bookCount===1?'book':'books'}</span></div>
          <div className={styles.shelfFrame}><ShelfCanvas shelf={profile.featured.shelf} books={profile.featured.books} onBookOpen={bookId=>openBook(profile.featured.books.find(book=>book.id===bookId)??null)}/></div>
          <p className={styles.previewNote}>A little introduction, one shelf at a time.</p>
        </section>
        {profile.featured.books.length>0&&<section className={styles.publicBookList}><h2>On this shelf</h2><div>{profile.featured.books.map(book=><button key={book.id} className={styles.bookRow} onClick={()=>openBook(book)}><BookCover book={book} small/><span><strong>{book.title}</strong><small>{book.author}</small></span><ArrowUpRight size={15}/></button>)}</div></section>}
        <ProfileJournal profileId={profile.id} name={profile.name}/>
        <section className={styles.invitation}><div><h2>A shelf can say a lot about you.</h2><p>Collect your books. Make a little world of your own.</p></div><a href="/" className="button primary">Start your shelf <ArrowUpRight size={15}/></a></section>
      </>:null}
    </main>
    <footer className={styles.publicFooter}><a href="/" className={styles.brand}><BrandWordmark/></a><p>A home for your books.</p></footer>
    {selected&&<Modal title={selected.title} subtitle={selected.author} onClose={()=>setSelected(null)}><div className={`${styles.publicBookDetail} dialog-body`}><BookCover book={selected}/><p>Featured on {profile?.name}’s shelf. Keep the title for your next visit to a bookshop or library.</p><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(selected.title+' — '+selected.author);setCopied(true);}catch{setCopied(false);}}}><Copy size={14}/>{copied?'Book details copied':'Copy title & author'}</button><a className="button primary" href={selected.catalogId?"/books/"+encodeURIComponent(selected.catalogId):"/books?q="+encodeURIComponent(selected.title+" "+selected.author)}>Book page & editions <ArrowUpRight size={14}/></a><a href="/" className="text-button">Create your own bookshelf <ArrowUpRight size={13}/></a></div></Modal>}
  </div>;
}
