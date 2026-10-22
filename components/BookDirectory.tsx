'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Library, LoaderCircle, Search } from 'lucide-react';
import type { SearchBook } from '@/lib/types';
import { normalizeCatalogId } from '@/lib/book-catalog';
import BrandWordmark from './BrandWordmark';
import BookCover from './BookCover';
import styles from './BookDirectory.module.css';

export default function BookDirectory({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchBook[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [searched, setSearched] = useState('');
  const request = useRef<AbortController | null>(null);
  const find = useCallback(async (value: string) => {
    const term = value.trim().slice(0, 200);
    if (term.length < 2) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setSearched(term); setResults([]);
    try {
      const response = await fetch('/api/search?q=' + encodeURIComponent(term), { signal: controller.signal });
      const data = await response.json() as { books?: SearchBook[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'The catalog could not be searched just now. Please try again.');
      if (!controller.signal.aborted) {
        setResults((data.books ?? []).filter(book => normalizeCatalogId(book.catalogId)));
        window.history.replaceState(window.history.state, '', '/books?q=' + encodeURIComponent(term));
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The catalog could not be searched.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => { if (initialQuery.trim().length >= 2) void find(initialQuery); return () => request.current?.abort(); }, [initialQuery, find]);

  return <div className={styles.page}>
    <header className={styles.header}><a href="/" aria-label="Cybershelf home"><BrandWordmark /></a><nav aria-label="Book catalog navigation"><a href="/?view=explore">Explore shelves</a><a href="/?view=library"><Library size={15} />Your library</a></nav></header>
    <main className={styles.main}>
      <header className={styles.intro}><p className="eyebrow">A PLACE FOR EVERY STORY</p><h1>Find your next<br /><em>conversation.</em></h1><p>Meet a book through its editions and the people reading it. Keep a place for it in your own library.</p></header>
      <form className={styles.search} onSubmit={event => { event.preventDefault(); void find(query); }}><Search size={21} strokeWidth={1.5} /><input aria-label="Search the book catalog" placeholder="A title, an author, an ISBN…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /><button className="button primary" disabled={busy || query.trim().length < 2}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}<span>Find books</span></button></form>
      {error ? <div className={styles.state} role="alert"><h2>The catalog needs a moment.</h2><p>{error}</p><button className="button secondary" onClick={() => void find(query)}>Try again</button></div> : busy ? <div className={styles.state} role="status"><LoaderCircle size={24} className="spin" /><p>Looking through the catalog…</p></div> : searched ? <section aria-label="Book search results"><div className={styles.resultsHeading}><h2>Stories that match</h2><span>{results.length} results for “{searched}”</span></div>{results.length ? <div className={styles.grid}>{results.map(book => <a className={styles.card} key={book.catalogId} href={'/books/' + encodeURIComponent(book.catalogId!)}><div className={styles.cover}><BookCover book={{ ...book, id: book.catalogId!, color: '#7e8b72' }} /></div><div><h3>{book.title}</h3><p>{book.author}</p><span>Book page & editions <ArrowUpRight size={14} /></span></div></a>)}</div> : <div className={styles.state}><BookOpen size={30} strokeWidth={1.2} /><h2>No match this time.</h2><p>Try a different title or author. A book can still belong in your library before it has a catalog page.</p><a href="/?add=manual" className="button secondary">Add a book manually <ArrowRight size={15} /></a></div>}</section> : <section className={styles.invitation}><span><BookOpen size={24} strokeWidth={1.2} /></span><div><h2>One story. Many ways to find it.</h2><p>Choose an edition, see Cybershelf’s community ratings and completed reads, or add a book you’ve always meant to read.</p></div></section>}
      <p className={styles.credit}>Catalog descriptions, covers, and available editions come from <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library <ArrowUpRight size={12} /></a>. Community ratings and read counts come from readers on Cybershelf.</p>
    </main>
    <footer className={styles.footer}><BrandWordmark /><span>A home for your books. A little company along the way.</span></footer>
  </div>;
}
