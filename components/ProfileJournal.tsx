'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react';
import type { Book, ReadingPost, StateResponse } from '@/lib/types';
import { progressLabel, readerPosition, readingBookKey, readingDate } from '@/lib/reading';
import BookCover from './BookCover';
import SpoilerText from './SpoilerText';
import styles from './ReadingConversation.module.css';

export default function ProfileJournal({ profileId, name }: { profileId: string; name: string }) {
  const [posts, setPosts] = useState<ReadingPost[]>([]), [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [cursor, setCursor] = useState<string | undefined>();
  const [bookFilter, setBookFilter] = useState('all'), [order, setOrder] = useState('recent'), [protect, setProtect] = useState(true);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [checkingViewer, setCheckingViewer] = useState(true), [viewerError, setViewerError] = useState('');
  const [viewerAccount, setViewerAccount] = useState<string | null>(null), [viewerRetry, setViewerRetry] = useState(0);
  const viewerIdentity = useRef<string | null | undefined>(undefined);
  const pageGeneration = useRef(0), pageController = useRef<AbortController | null>(null);
  const load = useCallback(async (next?: string) => {
    pageController.current?.abort();
    const controller = new AbortController(), generation = ++pageGeneration.current;
    pageController.current = controller;
    const current = () => generation === pageGeneration.current && !controller.signal.aborted;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/profiles/' + encodeURIComponent(profileId) + '/journal' + (next ? '?cursor=' + encodeURIComponent(next) : ''), { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const result = await response.json() as { posts: ReadingPost[]; nextCursor?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'This reading journal could not be opened.');
      if (current()) { setPosts(current => next ? [...current, ...result.posts.filter(post => !current.some(existing => existing.id === post.id))] : result.posts); setCursor(result.nextCursor); }
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { if (current()) { setLoading(false); pageController.current = null; } }
  }, [profileId]);

  useEffect(() => {
    setPosts([]); setBooks([]); setBookFilter('all'); setPositions({}); setProtect(true); setOrder('recent'); setCursor(undefined);
    void load();
    return () => { pageGeneration.current++; pageController.current?.abort(); pageController.current = null; };
  }, [load]);

  useEffect(() => {
    let controller: AbortController | null = null, sequence = 0, active = true;
    const refresh = async () => {
      if (controller) return;
      controller = new AbortController();
      const request = controller, generation = ++sequence;
      const current = () => active && generation === sequence && !request.signal.aborted;
      setCheckingViewer(true); setBooks([]); setViewerError('');
      try {
        const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok && response.status !== 401) throw new Error('Your saved reading place could not be checked. Thoughts are protected until you reveal them.');
        const result = response.ok ? await response.json() as StateResponse : null;
        if (!current()) return;
        const nextAccount = result?.user.id ?? null;
        if (viewerIdentity.current !== undefined && viewerIdentity.current !== nextAccount) { setPositions({}); setProtect(true); }
        viewerIdentity.current = nextAccount; setViewerAccount(nextAccount); setBooks(result?.state?.books ?? []);
      } catch (reason) { if (current()) setViewerError(reason instanceof Error ? reason.message : 'Your reading place could not be checked.'); }
      finally { if (current()) { setCheckingViewer(false); controller = null; } }
    };
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
      else { sequence++; controller?.abort(); controller = null; setCheckingViewer(true); setBooks([]); }
    };
    void refresh(); window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; sequence++; controller?.abort(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, [profileId, viewerRetry]);

  const catalog = useMemo(() => Array.from(new Map(posts.map(post => [readingBookKey(post.book), post.book])).entries()), [posts]);
  const selectedBook = catalog.find(([key]) => key === bookFilter)?.[1];
  const selectedPosition = selectedBook && !viewerError ? positions[bookFilter] ?? readerPosition(selectedBook, books).progress : 0;
  const visible = posts.filter(post => bookFilter === 'all' || readingBookKey(post.book) === bookFilter).sort((a, b) => order === 'progress' ? a.entry.progress - b.entry.progress || a.entry.createdAt.localeCompare(b.entry.createdAt) : b.publishedAt.localeCompare(a.publishedAt));

  return <section className={styles.profileJournal} aria-label={name + '’s reading journal'}>
    <header className={styles.journalHeading}><div><p className={styles.eyebrow}>Along the way</p><h2>A reading life, in moments.</h2><p>Thoughts {name} has chosen to share. Pick a book to follow its journey.</p></div><BookOpen size={24} strokeWidth={1.3}/></header>
    {posts.length > 0 && <div className={styles.journalControls}>
      <label>Book<select value={bookFilter} onChange={event => { setBookFilter(event.target.value); setOrder(event.target.value === 'all' ? 'recent' : 'progress'); }}><option value="all">All reading updates</option>{catalog.map(([key, book]) => <option key={key} value={key}>{book.title}</option>)}</select></label>
      <label>Order<select value={order} onChange={event => setOrder(event.target.value)}><option value="recent">Newest first</option><option value="progress">Reading order</option></select></label>
      <label className={styles.check}><input type="checkbox" checked={checkingViewer || !!viewerError || protect} disabled={checkingViewer || !!viewerError} onChange={event => setProtect(event.target.checked)}/><ShieldCheck size={15}/>Hide thoughts ahead of me</label>
      {selectedBook && <label>Your place in this book <span><input type="number" min="0" max="100" step="0.1" value={checkingViewer ? '' : selectedPosition} disabled={checkingViewer || !!viewerError} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setPositions(current => ({ ...current, [bookFilter]: Math.min(100, Math.max(0, value)) })); }}/> %</span></label>}
    </div>}
    {selectedBook && <p className={styles.help}>Your place here controls spoiler hiding. It doesn’t change your saved library progress.</p>}
    {checkingViewer && <p className={styles.help} role="status">Checking your account and reading progress…</p>}
    {viewerError && <p className={styles.help} role="status">{viewerError} <button className="text-button" onClick={() => setViewerRetry(value => value + 1)}>Check again</button></p>}
    <div className={styles.journalEntries}>{visible.map(post => {
      const key = readingBookKey(post.book), known = readerPosition(post.book, books), override = viewerError ? undefined : positions[key];
      return <article key={post.id} className={styles.profileEntry}>
        <div className={styles.entryBook}><BookCover book={post.book} small/><div><h3>{post.book.title}</h3><p>{post.book.author}</p><span className={styles.marker}>{progressLabel(post.entry.progress, post.entry.page)}</span></div><time dateTime={post.entry.createdAt}>{readingDate(post.entry.createdAt)}</time></div>
        {post.entry.body ? <><div hidden={checkingViewer}><SpoilerText key={viewerError ? 'unknown' : viewerAccount ?? 'guest'} body={post.entry.body} progress={post.entry.progress} readerProgress={override ?? known.progress} unread={override === undefined ? known.unread : override === 0} defaultHide={!!viewerError || protect}/></div>{checkingViewer && <p className={styles.help}>Checking your reading place…</p>}</> : <p className={styles.milestone}>{post.entry.progress === 100 ? 'Finished this book.' : post.entry.progress === 0 ? 'Started reading.' : `Reached ${post.entry.progress}%.`}</p>}
        <footer className={styles.entryFooter}><a href={'/j/' + encodeURIComponent(post.id)}><MessageCircle size={14}/>{post.commentCount ? `${post.commentCount} ${post.commentCount === 1 ? 'reply' : 'replies'}` : 'Read along & reply'}<ArrowUpRight size={13}/></a>{bookFilter === 'all' && <button className="text-button" onClick={() => { setBookFilter(key); setOrder('progress'); }}>Follow this book’s journey</button>}</footer>
      </article>;
    })}</div>
    {loading && <div className={styles.inlineState} aria-busy="true"><LoaderCircle size={18} className="spin"/>Opening the journal…</div>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="text-button" onClick={() => void load(posts.length ? cursor : undefined)}>Try again</button></div>}
    {!loading && !error && !posts.length && <div className={styles.journalEmpty}><BookOpen size={25} strokeWidth={1.3}/><p>A little space for thoughts still to come.</p><span>Shared reading updates will appear here.</span></div>}
    {cursor && !error && <button className="button secondary" disabled={loading} onClick={() => void load(cursor)}>Earlier reading moments</button>}
  </section>;
}
