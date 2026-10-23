'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, ChevronDown, Globe, LoaderCircle, MessageCircle, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { ActivityEvent, AppState, Book } from '@/lib/types';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { readerPosition, readingBookKey } from '@/lib/reading';
import { displayReadingProgress } from '@/lib/reading-progress';
import BookCover from './BookCover';
import ShelfCanvas from './ShelfCanvas';
import SpoilerText from './SpoilerText';
import styles from './Feed.module.css';

type FollowingReader = { id: string; name: string; bio: string; unavailable?: boolean };
type FeedResponse = { items: ActivityEvent[]; followingCount: number; nextCursor?: string };
type PeopleResponse = { following: FollowingReader[]; ownProfileId?: string };
async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'This request could not be completed.');
  return result;
}
interface Props {
  state: AppState; accountId: string | null; ready: boolean; flush: () => Promise<void>;
  onOpenProfile: () => void; onExplore: () => void; notify: (message: string) => void;
  onReadTogether?: (bookId: string) => void;
}
const eventLabels: Record<ActivityEvent['kind'], string> = {
  reading: 'shared a reading update', comment: 'joined a conversation', shelf: 'shared a shelf', shelf_updated: 'rearranged a shelf', purchased: 'bought a book', added: 'added a book to their library',
};
function eventLabel(item: ActivityEvent) {
  if (item.kind === 'reading' && item.progress === 0) return 'started reading';
  if (item.kind === 'reading' && item.progress === 100) return 'finished a book';
  return eventLabels[item.kind];
}
function displayDate(value: string) { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

export default function FollowingFeed({ state, accountId, ready, flush, onOpenProfile, onExplore, notify, onReadTogether }: Props) {
  const [items, setItems] = useState<ActivityEvent[]>([]), [following, setFollowing] = useState<FollowingReader[]>([]), [ownUpdates, setOwnUpdates] = useState<ActivityEvent[]>([]);
  const [ownProfileId, setOwnProfileId] = useState(''), [followingCount, setFollowingCount] = useState(0), [nextCursor, setNextCursor] = useState<string | undefined>();
  const [ownNextCursor, setOwnNextCursor] = useState<string | undefined>(), [loadingOwnMore, setLoadingOwnMore] = useState(false);
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState(''), [sharing, setSharing] = useState(false), [shareError, setShareError] = useState(''), [removing, setRemoving] = useState('');
  const [hideAhead, setHideAhead] = useState(true), [hideUnread, setHideUnread] = useState(true), [composerOpen, setComposerOpen] = useState(false);
  const [shareKind, setShareKind] = useState<'added' | 'purchased'>('added'), [bookId, setBookId] = useState('');
  const requestSerial = useRef(0), activeRequest = useRef<AbortController | null>(null), paginationActive = useRef(false), currentAccount = useRef(accountId);
  currentAccount.current = accountId;
  const conversationBooks = useMemo(() => {
    const matches = new Map<string, Book>();
    const byReadingPlace = [...state.books].sort((a, b) => Number(b.status === 'reading') - Number(a.status === 'reading') || (a.status === 'read' ? 100 : a.progress) - (b.status === 'read' ? 100 : b.progress));
    for (const book of byReadingPlace) { const key = readingBookKey(book); if (!matches.has(key)) matches.set(key, book); }
    return matches;
  }, [state.books]);
  const bookChoices = useMemo(() => [...state.books].sort((a, b) => a.title.localeCompare(b.title)), [state.books]);
  const refresh = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    const serial = ++requestSerial.current; activeRequest.current?.abort(); const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true); setError(''); setLoadingMore(false); setLoadingOwnMore(false); paginationActive.current = false;
    try {
      const headers = { [ACCOUNT_ID_HEADER]: accountId };
      const responses = await Promise.all(['/api/feed', '/api/follows', '/api/activity'].map(path => fetch(path, { headers, cache: 'no-store', signal: controller.signal })));
      const [feed, people, updates] = await Promise.all([
        readResponse<FeedResponse>(responses[0]), readResponse<PeopleResponse>(responses[1]), readResponse<{ items: ActivityEvent[]; nextCursor?: string }>(responses[2]),
      ]);
      if (serial !== requestSerial.current) return;
      setItems(feed.items); setFollowingCount(feed.followingCount); setNextCursor(feed.nextCursor); setFollowing(people.following); setOwnProfileId(people.ownProfileId || ''); setOwnUpdates(updates.items); setOwnNextCursor(updates.nextCursor);
    } catch (reason) { if (serial === requestSerial.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Your feed could not be loaded.'); }
    finally { if (serial === requestSerial.current) { setLoading(false); activeRequest.current = null; } }
  }, [accountId]);
  useEffect(() => {
    setItems([]); setFollowing([]); setOwnUpdates([]); setOwnProfileId(''); setFollowingCount(0); setNextCursor(undefined); setOwnNextCursor(undefined); setComposerOpen(false); setShareError(''); setSharing(false); setRemoving(''); setBookId('');
    void refresh(); const changed = () => { void refresh(); };
    const visibleRefresh = () => { if (document.visibilityState === 'visible' && !activeRequest.current && !paginationActive.current) void refresh(); };
    window.addEventListener('cybershelf:following-changed', changed); window.addEventListener('focus', visibleRefresh); document.addEventListener('visibilitychange', visibleRefresh);
    const interval = window.setInterval(visibleRefresh, 60000);
    return () => { ++requestSerial.current; activeRequest.current?.abort(); window.clearInterval(interval); window.removeEventListener('cybershelf:following-changed', changed); window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh); };
  }, [refresh]);
  const loadMore = async () => {
    if (!accountId || !nextCursor || loadingMore) return;
    const serial = requestSerial.current; setLoadingMore(true); paginationActive.current = true; setError('');
    try {
      const response = await fetch('/api/feed?cursor=' + encodeURIComponent(nextCursor), { headers: { [ACCOUNT_ID_HEADER]: accountId }, cache: 'no-store' });
      const result = await readResponse<FeedResponse>(response);
      if (serial !== requestSerial.current) return;
      setItems(current => { const seen = new Set(current.map(item => item.kind + ':' + item.id)); return [...current, ...result.items.filter((item: ActivityEvent) => !seen.has(item.kind + ':' + item.id))]; });
      setNextCursor(result.nextCursor);
    } catch (reason) { if (serial === requestSerial.current) setError(reason instanceof Error ? reason.message : 'Could not load more updates.'); }
    finally { if (serial === requestSerial.current) { setLoadingMore(false); paginationActive.current = false; } }
  };
  const share = async (event: React.FormEvent) => {
    event.preventDefault(); if (!accountId || !bookId || !ready || sharing) return; setSharing(true); setShareError('');
    try {
      await flush(); if (currentAccount.current !== accountId) return;
      const response = await fetch('/api/activity', { method: 'POST', headers: { [ACCOUNT_ID_HEADER]: accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: shareKind, bookId }) });
      const result = await readResponse<{ item: ActivityEvent }>(response);
      if (currentAccount.current !== accountId) return;
      setOwnUpdates(current => [result.item, ...current].slice(0, 20)); setBookId(''); setComposerOpen(false); notify('Shared with your followers.'); void refresh();
    } catch (reason) { if (currentAccount.current === accountId) setShareError(reason instanceof Error ? reason.message : 'Could not share your update.'); }
    finally { if (currentAccount.current === accountId) setSharing(false); }
  };
  const loadOwnMore = async () => {
    if (!accountId || !ownNextCursor || loadingOwnMore || loading) return;
    const serial = requestSerial.current; setLoadingOwnMore(true); setShareError('');
    try {
      const response = await fetch('/api/activity?cursor=' + encodeURIComponent(ownNextCursor), { headers: { [ACCOUNT_ID_HEADER]: accountId }, cache: 'no-store' });
      const result = await readResponse<{ items: ActivityEvent[]; nextCursor?: string }>(response);
      if (serial !== requestSerial.current) return;
      setOwnUpdates(current => { const ids = new Set(current.map(item => item.id)); return [...current, ...result.items.filter(item => !ids.has(item.id))]; }); setOwnNextCursor(result.nextCursor);
    } catch (reason) { if (serial === requestSerial.current) setShareError(reason instanceof Error ? reason.message : 'Could not load your older updates.'); }
    finally { if (serial === requestSerial.current) setLoadingOwnMore(false); }
  };
  const removeUpdate = async (id: string) => {
    if (!accountId || removing) return; setRemoving(id); setShareError('');
    try {
      const response = await fetch('/api/activity/' + encodeURIComponent(id), { method: 'DELETE', headers: { [ACCOUNT_ID_HEADER]: accountId } });
      await readResponse<{ removed: boolean }>(response);
      if (currentAccount.current !== accountId) return;
      setOwnUpdates(current => current.filter(item => item.id !== id)); notify('Update removed. Your library is unchanged.'); void refresh();
    } catch (reason) { if (currentAccount.current === accountId) setShareError(reason instanceof Error ? reason.message : 'Could not remove this update.'); }
    finally { if (currentAccount.current === accountId) setRemoving(''); }
  };
  const unfollow = async (id: string) => {
    if (!accountId || removing) return; setRemoving(id); setError('');
    try {
      const response = await fetch('/api/follows/' + encodeURIComponent(id), { method: 'DELETE', headers: { [ACCOUNT_ID_HEADER]: accountId } });
      await readResponse<{ following: boolean }>(response);
      if (currentAccount.current !== accountId) return;
      await refresh(); notify('Reader unfollowed.');
    } catch (reason) { if (currentAccount.current === accountId) setError(reason instanceof Error ? reason.message : 'Could not unfollow this reader.'); }
    finally { if (currentAccount.current === accountId) setRemoving(''); }
  };
  return <div className={styles.feed}>
    <header className="page-heading"><div><p className="eyebrow">Your reading circle</p><h1>Following<span className="title-period">.</span></h1><p className="page-description">Books, shelves, and conversations from the readers you follow.</p></div>
      {accountId ? <div className="heading-actions"><button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Refresh</button><button className="button primary" onClick={() => setComposerOpen(value => !value)} aria-expanded={composerOpen}><Plus size={16} />Share an update</button></div> : null}
    </header>
    {!accountId ? <div className={styles.empty}><Users size={32} strokeWidth={1.2} /><h2>Find your kind of reader.</h2><p>Follow public profiles to keep their reading lives close, with spoilers tucked away until you are ready.</p><a className="button primary" href={signInPath('/')}>Sign in to follow readers<ArrowUpRight size={15} /></a><button className="text-button" onClick={onExplore}>Explore shelves</button></div> : <>
      {composerOpen ? <section className={styles.composer} aria-label="Share a book update"><div className={styles.sectionTitle}><BookOpen size={18} /><h2>A new book in your world</h2></div>
        {!ownProfileId && !loading ? <div className={styles.profilePrompt}><p>Publish your profile so people can discover your updates and follow you.</p><button className="button primary" onClick={onOpenProfile}>Open your profile<ArrowUpRight size={14} /></button></div> : <form onSubmit={event => void share(event)}>
          <div className={styles.composerFields}><label className="field">What would you like to share?<select value={shareKind} onChange={event => setShareKind(event.target.value as 'added' | 'purchased')}><option value="added">Added to my library</option><option value="purchased">Bought a book</option></select></label><label className="field">Book<select required value={bookId} onChange={event => setBookId(event.target.value)}><option value="">Choose a book…</option>{bookChoices.map(book => <option value={book.id} key={book.id}>{book.title} · {book.author}</option>)}</select></label></div>
          <div className={styles.composerFooter}><p><Globe size={13} />Public update: the title, author, and cover.</p><button className="button primary" disabled={!bookId || !ready || sharing || !ownProfileId}>{sharing ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}Share update</button></div>
          {!bookChoices.length ? <p className={styles.hint}>Add a book to your library first.</p> : null}
        </form>}
      </section> : null}
      {shareError ? <p className="notice error" role="alert">{shareError}</p> : null}
      <section className={styles.filters} aria-label="Spoiler preferences"><div><ShieldCheck size={17} /><strong>Your pace comes first</strong></div><div className={styles.filterControls}>
        <label><input type="checkbox" checked={hideAhead} onChange={event => setHideAhead(event.target.checked)} />Hide thoughts ahead of me</label><label><input type="checkbox" checked={hideUnread} onChange={event => setHideUnread(event.target.checked)} />Hide thoughts for unread books</label>
        <button type="button" className="text-button" onClick={() => { const next = !hideAhead && !hideUnread; setHideAhead(next); setHideUnread(next); }}>{hideAhead || hideUnread ? 'Show all' : 'Restore protection'}</button>
      </div><p>Matches your library by title and author. You can reveal any hidden update individually.</p></section>
      {following.length || ownUpdates.length ? <div className={styles.personalLists}>
        {following.length ? <details className={styles.people}><summary><Users size={14} />Following {following.length} readers<ChevronDown size={14} /></summary><div className={styles.peopleList}>{following.map(reader => <div className={styles.person} key={reader.id}><div>{reader.unavailable ? <span>{reader.name}</span> : <a href={'/u/' + reader.id}>{reader.name}</a>}<small>{reader.unavailable ? 'This reader’s profile is currently private.' : reader.bio || 'A fellow reader'}</small></div><button className="text-button" disabled={!!removing} onClick={() => void unfollow(reader.id)}>{removing === reader.id ? 'Removing…' : 'Unfollow'}</button></div>)}</div></details> : null}
        {ownUpdates.length ? <details className={styles.people}><summary><BookOpen size={14} />Your shared book updates<ChevronDown size={14} /></summary><div className={styles.peopleList}>{ownUpdates.map(item => <div className={styles.person} key={item.id}><div><strong>{item.book?.title}</strong><small>{item.kind === 'purchased' ? 'Bought a book' : 'Added to your library'} · {displayDate(item.createdAt)}{item.actor.id !== ownProfileId ? ' · Not currently public' : ''}</small></div><button className="icon-button" disabled={!!removing} onClick={() => void removeUpdate(item.id)} aria-label={'Remove update about ' + item.book?.title}>{removing === item.id ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}</button></div>)}</div>{ownNextCursor ? <div className={styles.historyMore}><button type="button" className="text-button" disabled={loadingOwnMore || loading} onClick={() => void loadOwnMore()}>{loadingOwnMore ? 'Loading…' : 'Older updates'}<ChevronDown size={13} /></button></div> : null}</details> : null}
      </div> : null}
      {error ? <div className={styles.error} role="alert"><p>{error}</p><button className="button secondary" onClick={() => void refresh()}>Try again</button></div> : null}
      {loading && !items.length ? <div className={styles.loading} role="status"><LoaderCircle className="spin" size={22} />Opening your reading circle…</div> : null}
      {!loading && !error && !items.length ? <div className={styles.empty}><Users size={32} strokeWidth={1.2} /><h2>{followingCount ? 'A quiet moment in your circle.' : 'Good books lead to good company.'}</h2><p>{followingCount ? 'New shared reading updates, conversations, shelves, and book finds will appear here.' : 'Explore a shelf, visit its reader’s profile, and follow them to bring their updates here.'}</p><button className="button primary" onClick={onExplore}>Explore shelves<ArrowUpRight size={15} /></button></div> : null}
      <div className={styles.stream}>{items.map(item => {
        const conversationBook = item.book && (item.kind === 'reading' || item.kind === 'comment') ? conversationBooks.get(readingBookKey(item.book)) : undefined;
        const position = item.book ? readerPosition(item.book, state.books) : { progress: 0, unread: true };
        const guarded = hideUnread && position.unread || hideAhead && (item.progress ?? 0) > position.progress;
        return <article className={styles.card} key={item.kind + ':' + item.id}>
          <div className={styles.byline}><a className={styles.avatar} href={'/u/' + item.actor.id} aria-label={'Visit ' + item.actor.name + '’s profile'}>{item.actor.name.slice(0, 1).toUpperCase()}</a><div><a href={'/u/' + item.actor.id}>{item.actor.name}</a><span>{eventLabel(item)}</span></div><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{displayDate(item.createdAt)}</time></div>
          {item.book ? <div className={styles.bookHeading}><BookCover book={item.book} small /><div><h2>{item.book.title}</h2><p>{item.book.author}</p></div>{item.progress !== undefined ? <span className={styles.progress}>{displayReadingProgress(item.progress)}% through</span> : null}</div> : null}
          {item.body ? <SpoilerText body={item.body} progress={item.progress ?? 0} readerProgress={position.progress} unread={position.unread} defaultHide={guarded} /> : item.kind === 'reading' ? <p className={styles.progressOnly}>A new bookmark at {displayReadingProgress(item.progress ?? 0)}%.</p> : null}
          {item.shelf ? <a className={styles.shelfPreview} href={'/s/' + item.shelf.id}><div><ShelfCanvas shelf={item.shelf.shelf} books={item.shelf.books} compact /></div><h2>{item.shelf.shelf.title}</h2><p>{item.shelf.bookCount} books<ArrowUpRight size={15} /></p></a> : null}
          {item.postId || conversationBook && onReadTogether ? <footer className={styles.cardFooter}>{conversationBook && onReadTogether ? <button type="button" className={styles.readTogether} onClick={() => onReadTogether(conversationBook.id)}><Users size={14}/>Read together at my bookmark<ArrowUpRight size={13}/></button> : null}{item.postId ? <a href={'/j/' + item.postId + (item.commentId ? '#comment-' + item.commentId : '')}><MessageCircle size={14}/>{conversationBook && onReadTogether ? 'Open shared entry' : 'Open conversation'}<ArrowUpRight size={13}/></a> : null}</footer> : null}
        </article>;
      })}</div>
      {nextCursor ? <div className={styles.more}><button className="button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : <ChevronDown size={15} />}More updates</button></div> : null}
    </>}
  </div>;
}
