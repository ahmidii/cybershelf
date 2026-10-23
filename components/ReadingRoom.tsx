'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Bookmark, Check, ChevronDown, Globe, LoaderCircle, LockKeyhole, MessageCircle, PenLine, RefreshCw, Send, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import type { AppState, Book, ReadingComment, ReadingPost } from '@/lib/types';
import { uid } from '@/lib/types';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { appendReadingEntry, makeReadingEntry, readingMarker, READING_THOUGHT_LIMIT } from '@/lib/reading-log';
import { readingBookKey, readingDate } from '@/lib/reading';
import { bookReadingProgress, currentReadingPage, displayReadingProgress, readingInputPages } from '@/lib/reading-progress';
import ReadingProgressInput from './ReadingProgressInput';
import type { ReadingRoomCommentsResponse, ReadingRoomOrder, ReadingRoomResponse } from '@/lib/reading-room';
import BookCover from './BookCover';
import ReadingJournal from './ReadingJournal';
import styles from './ReadingRoom.module.css';

interface Props {
  state: AppState;
  update: (updater: (current: AppState) => AppState) => void;
  accountId: string | null;
  ready: boolean;
  flush: () => Promise<void>;
  onBookOpen: (bookId: string) => void;
  onOpenProfile: () => void;
  onExplore: () => void;
  notify: (message: string) => void;
  initialBookId?: string;
}

const percentage = displayReadingProgress;
const bookProgress = bookReadingProgress;
const bookmarkLabel = (book: Book, progress: number) => book.pages
  ? `page ${currentReadingPage(book) ?? 0} of ${book.pages.toLocaleString()}`
  : `${percentage(progress)}%`;

class RoomRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'RoomRequestError'; }
}

async function roomRequest<T>(path: string, accountId: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store', credentials: 'same-origin', ...options,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { [ACCOUNT_ID_HEADER]: accountId, ...options.headers },
  });
  const result = response.status === 204 ? {} : await response.json() as { error?: string };
  if (!response.ok) throw new RoomRequestError((result as { error?: string }).error || 'This conversation could not be loaded. Please try again.', response.status);
  return result as T;
}

export default function ReadingRoom(props: Props) {
  const { state, initialBookId, onExplore } = props;
  const first = state.books.find(book => book.id === initialBookId) ?? state.books.find(book => book.status === 'reading') ?? state.books[0];
  const [bookId, setBookId] = useState(first?.id ?? '');
  const books = useMemo(() => [...state.books].sort((a, b) => Number(b.status === 'reading') - Number(a.status === 'reading') || a.title.localeCompare(b.title)), [state.books]);
  const selected = state.books.find(book => book.id === bookId) ?? first;
  useEffect(() => { if (initialBookId) setBookId(initialBookId); }, [initialBookId]);

  return <section className={styles.room} aria-label="Reading together">
    <header className="page-heading"><div><p className="eyebrow">SAME STORY, YOUR OWN PACE</p><h1>Reading together<span className="title-period">.</span></h1><p className="page-description">Keep your place, collect your thoughts, and find your people in the same story.</p></div></header>
    {selected ? <>
      <div className={styles.chooseBook}><BookOpen size={19} strokeWidth={1.5}/><label><span>What are you reading?</span><select aria-label="Book to read together" value={selected.id} onChange={event => setBookId(event.target.value)}>{books.map(book => <option key={book.id} value={book.id}>{book.title} — {book.author}</option>)}</select></label><span className={styles.circleTag}><UsersRound size={14}/>Your reading circle</span></div>
      <BookRoom key={`${props.accountId ?? 'guest'}:${selected.id}:${readingBookKey(selected)}`} {...props} book={selected}/>
    </> : <div className={styles.empty}><BookOpen size={34} strokeWidth={1.2}/><h2>Every book is a place to meet.</h2><p>Add a book to your library, then open it here. Your circle’s shared thoughts will gather around the same story.</p><button type="button" className="button secondary" onClick={onExplore}>Explore shelves<ArrowUpRight size={14}/></button></div>}
  </section>;
}

function BookRoom({ book, state, update, accountId, ready, flush, onBookOpen, onOpenProfile, onExplore, notify }: Props & { book: Book }) {
  const progress = bookProgress(book);
  const [order, setOrder] = useState<ReadingRoomOrder>('position');
  const [readingView, setReadingView] = useState<'circle' | 'journal'>('circle');
  const [room, setRoom] = useState<ReadingRoomResponse | null>(null);
  const [loading, setLoading] = useState(false), [loadingMore, setLoadingMore] = useState(false), [loadError, setLoadError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState<'page' | 'percent'>('page');
  const [marker, setMarker] = useState(String(currentReadingPage(book) ?? ''));
  const [totalPages, setTotalPages] = useState('');
  const [saving, setSaving] = useState(false);
  const markerEdited = useRef(false), modeRef = useRef(mode); modeRef.current = mode;
  const [body, setBody] = useState(''), [posting, setPosting] = useState(false), [postError, setPostError] = useState('');
  const [pendingEntry, setPendingEntry] = useState<string | null>(null), [profileNeeded, setProfileNeeded] = useState(false);
  const active = useRef(true), serial = useRef(0), request = useRef<AbortController | null>(null);
  const current = useRef({ book, state, ready }); current.current = { book, state, ready };
  const busy = useRef(false); busy.current = saving || posting || loadingMore;
  const protectedProgress = Math.min(progress, room?.reader.progress ?? progress);
  const shown = ready ? room?.items.filter(post => post.entry.progress <= protectedProgress) ?? [] : [];

  useEffect(() => { active.current = true; return () => { active.current = false; serial.current++; request.current?.abort(); }; }, []);
  useEffect(() => {
    if (markerEdited.current) return;
    setMarker(String(modeRef.current === 'page' ? currentReadingPage(book) ?? '' : progress));
  }, [progress, book.pages, book.currentPage]);
  useEffect(() => {
    if (pendingEntry && !book.readingLog?.some(entry => entry.id === pendingEntry)) { setPendingEntry(null); setProfileNeeded(false); }
  }, [book.readingLog, pendingEntry]);


  const refresh = useCallback(async (quiet = false) => {
    if (!accountId || !current.current.ready) return;
    request.current?.abort();
    const controller = new AbortController(), generation = ++serial.current;
    request.current = controller;
    if (!quiet) setLoading(true);
    setLoadError('');
    try {
      // The server only trusts the saved bookmark. Finish any local save first.
      await flush();
      if (!active.current || generation !== serial.current) return;
      const result = await roomRequest<ReadingRoomResponse>(`/api/reading-room?bookId=${encodeURIComponent(book.id)}&order=${order}`, accountId, { signal: controller.signal });
      if (!active.current || generation !== serial.current) return;
      setRoom(result); setRefreshTick(value => value + 1);
    } catch (reason) {
      if (active.current && generation === serial.current && !controller.signal.aborted) {
        // On authentication or revocation failure, never retain a stale room.
        setRoom(null); setLoadError(reason instanceof Error ? reason.message : 'Your reading circle could not be loaded.');
      }
    } finally {
      if (active.current && generation === serial.current) { setLoading(false); request.current = null; }
    }
  }, [accountId, book.id, order, flush]);

  useEffect(() => {
    setRoom(null);
    if (accountId && ready) void refresh();
    return () => { serial.current++; request.current?.abort(); request.current = null; };
  }, [accountId, ready, progress, book.pages, refresh]);

  useEffect(() => {
    if (!accountId) return;
    const visibleRefresh = () => {
      if (document.visibilityState === 'visible' && !request.current && !busy.current) void refresh(true);
    };
    const followingChanged = () => { setRoom(null); void refresh(); };
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener('cybershelf:following-changed', followingChanged);
    const timer = window.setInterval(visibleRefresh, 45000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh); window.removeEventListener('cybershelf:following-changed', followingChanged); };
  }, [accountId, refresh]);

  const more = async () => {
    if (!accountId || !room?.nextCursor || loadingMore || loading) return;
    const generation = serial.current, cursor = room.nextCursor;
    setLoadingMore(true); setLoadError('');
    try {
      const result = await roomRequest<ReadingRoomResponse>(`/api/reading-room?bookId=${encodeURIComponent(book.id)}&order=${order}&cursor=${encodeURIComponent(cursor)}`, accountId);
      if (!active.current || generation !== serial.current) return;
      setRoom(previous => previous ? { ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(prior => prior.id === item.id))] } : result);
    } catch (reason) { if (active.current && generation === serial.current) {
      if (reason instanceof RoomRequestError && [400, 401, 403, 404, 409].includes(reason.status)) setRoom(null);
      setLoadError(reason instanceof Error ? reason.message : 'More thoughts could not be loaded.');
    } }
    finally { if (active.current) setLoadingMore(false); }
  };

  const publishEntry = async (entryId: string) => {
    if (!accountId) return;
    const sharing = await roomRequest<{ profileId?: string }>('/api/journal', accountId);
    if (!active.current) return;
    if (!sharing.profileId) { setProfileNeeded(true); setReadingView('journal'); return; }
    await roomRequest('/api/journal', accountId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: book.id, entryId }) });
    if (!active.current) return;
    setPendingEntry(null); setProfileNeeded(false); setReadingView('circle');
    notify('Your reading update is shared. It will meet others at this point.');
    await refresh(true);
  };

  const saveThought = async (share: boolean) => {
    if (!ready || saving || posting) return;
    setPostError(''); setProfileNeeded(false); setSaving(!share); setPosting(share);
    try {
      const latest = current.current.book;
      const entry = makeReadingEntry(latest, { body, mode, marker, totalPages }, { id: uid('log_'), createdAt: new Date().toISOString() }, !markerEdited.current);
      // A thought at the existing bookmark must preserve its exact ceiling.
      // Display rounding and switching formats must not unlock more story.
      const pages = mode === 'page' ? readingInputPages(latest, totalPages) : undefined;
      update(library => appendReadingEntry(library, latest.id, entry, pages));
      setPendingEntry(share ? entry.id : null);
      setBody('');
      await flush();
      if (!active.current) return;
      markerEdited.current = false;
      if (share && accountId) await publishEntry(entry.id);
      else {
        setReadingView('journal');
        notify(accountId ? entry.body ? 'Thought saved privately in your journal.' : 'Reading progress saved privately in your journal.' : 'Reading update saved in your private browser draft.');
      }
    } catch (reason) { if (active.current) {
      if (reason instanceof RoomRequestError && [401, 403, 404, 409].includes(reason.status)) setRoom(null);
      setPostError(reason instanceof Error ? reason.message : 'Your thought could not be saved.');
    } }
    finally { if (active.current) { setPosting(false); setSaving(false); } }
  };

  const retryShare = async () => {
    if (!pendingEntry || posting || !ready || !accountId) return;
    setPosting(true); setPostError('');
    try { await flush(); if (active.current) await publishEntry(pendingEntry); }
    catch (reason) { if (active.current) {
      if (reason instanceof RoomRequestError && [401, 403, 404, 409].includes(reason.status)) setRoom(null);
      setPostError(reason instanceof Error ? reason.message : 'Your thought is saved privately. Sharing could not be completed.');
    } }
    finally { if (active.current) setPosting(false); }
  };

  return <div className={styles.layout}>
    <aside className={styles.bookSide}>
      <section className={styles.bookCard} aria-label="Your bookmark">
        <button type="button" className={styles.bookIdentity} onClick={() => onBookOpen(book.id)}><BookCover book={book}/><span><span className={styles.overline}>IN YOUR HANDS</span><strong>{book.title}</strong><small>{book.author}</small><span className={styles.detailsLink}>Book details<ArrowUpRight size={12}/></span></span></button>
        <div className={styles.bookmarkTitle}><Bookmark size={16}/><strong>Your bookmark</strong><span>{percentage(progress)}%</span></div>
        <div className={styles.progressTrack} role="progressbar" aria-label="Your reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }}/></div>
        <p className={styles.bookmarkHelp}>Your saved place in this story. Move your bookmark with or without a thought in the update beside it.</p>
      </section>
      <div className={styles.safetyNote}><ShieldCheck size={18}/><div><strong>A conversation at your pace</strong><p>Thoughts and replies beyond your saved bookmark stay out of this view. Different editions are matched by title and author, then compared by percentage; the match is approximate. Protection also depends on readers choosing accurate markers.</p></div></div>
    </aside>

    <div className={styles.conversation}>
      <section className={styles.composer} aria-label="Your reading update">
        <div className={styles.composerTitle}><PenLine size={19}/><div><h2>Leave a little bookmark.</h2><p>A thought is optional. Your place in the book is enough.</p></div></div>
        <ReadingProgressInput book={book} value={{ mode, marker, totalPages }} unchangedBookmark={!markerEdited.current} labelPrefix="Reading together " disabled={!ready || saving || posting} onEditPageCount={() => onBookOpen(book.id)} onChange={(patch, field) => {
          if (field !== 'mode') markerEdited.current = true;
          if (patch.mode !== undefined) setMode(patch.mode);
          if (patch.marker !== undefined) setMarker(patch.marker);
          if (patch.totalPages !== undefined) setTotalPages(patch.totalPages);
        }}/>
        <label className={styles.thoughtLabel}><span className={styles.optionalThought}>Your thought <small>optional</small></span><textarea value={body} onChange={event => setBody(event.target.value)} maxLength={READING_THOUGHT_LIMIT} rows={3} placeholder="A theory, a feeling, a line you’re still thinking about…" disabled={!ready || posting || saving}/></label>
        <div className={styles.composerActions}><span>{body.length.toLocaleString()} / 4,000</span><div><button type="button" className="button quiet" disabled={!ready || posting || saving} onClick={() => void saveThought(false)}>{saving ? <LoaderCircle className="spin" size={14}/> : <LockKeyhole size={14}/>}{body.trim() ? 'Keep privately' : 'Save my place'}</button>{accountId ? <button type="button" className="button primary" disabled={!ready || posting || saving} onClick={() => void saveThought(true)}>{posting ? <LoaderCircle className="spin" size={14}/> : <Send size={14}/>} {body.trim() ? 'Share thought' : 'Share progress'}</button> : <a className="button primary" href={signInPath('/')}><ArrowUpRight size={14}/>Sign in to share</a>}</div></div>
        <p className={styles.privacy}><Globe size={12}/>Sharing publishes this update, book, bookmark, and date on your profile. Your other notes stay private.</p>
        {postError ? <p className={styles.inlineError} role="alert">{postError}</p> : null}
        {pendingEntry ? <div className={styles.pending} role="status"><p><LockKeyhole size={14}/>Your reading update is in your private journal.{profileNeeded ? ' Publish a profile to share it with your reading circle.' : ' Share this saved update when you’re ready.'}</p>{profileNeeded ? <button type="button" className="text-button" onClick={onOpenProfile}>Open my profile<ArrowUpRight size={13}/></button> : <button type="button" className="text-button" onClick={() => void retryShare()} disabled={posting || !ready}>Share saved update<ArrowUpRight size={13}/></button>}</div> : null}
      </section>

      <div className={styles.readingViews} role="group" aria-label="Reading view"><button type="button" aria-pressed={readingView === 'circle'} aria-controls="reading-circle-panel" onClick={() => setReadingView('circle')}><UsersRound size={15}/>Your circle{room && <span>{room.totalVisible}</span>}</button><button type="button" aria-pressed={readingView === 'journal'} aria-controls="reading-journal-panel" onClick={() => setReadingView('journal')}><PenLine size={15}/>Your journal<span>{book.readingLog?.length ?? 0}</span></button></div>
      {readingView === 'journal' ? <div id="reading-journal-panel"><ReadingJournal state={state} update={update} accountId={accountId} ready={ready && !saving && !posting} flush={flush} onBookOpen={onBookOpen} onOpenProfile={onOpenProfile} notify={notify} embeddedBookId={book.id} initialBookId={book.id} refreshKey={refreshTick} onReadTogether={() => setReadingView('circle')} onSharingChanged={published => { setPendingEntry(null); setProfileNeeded(false); if (published) setReadingView('circle'); void refresh(true); }}/></div> : <div id="reading-circle-panel">
      <div className={styles.streamHeading}><div><p className="eyebrow">BETWEEN THE LINES</p><h2>Your circle, in this story.</h2></div>{accountId ? <button type="button" className="icon-button" aria-label="Refresh reading conversation" title="Refresh conversation" onClick={() => void refresh()} disabled={loading || loadingMore || !ready}><RefreshCw size={17} className={loading ? 'spin' : ''}/></button> : null}</div>
      <div className={styles.lens}><span><UsersRound size={14}/>Following & you</span><span><ShieldCheck size={14}/>Through {bookmarkLabel(book, protectedProgress)}</span><label><span className="sr-only">Conversation order</span><select value={order} onChange={event => setOrder(event.target.value as ReadingRoomOrder)}><option value="position">In reading order</option><option value="newest">Newest thoughts</option></select></label></div>

      {!accountId ? <div className={styles.empty}><UsersRound size={33} strokeWidth={1.2}/><h2>Different days. The same story.</h2><p>Follow readers you connect with. When they share a thought about this book, you’ll find it here once your bookmark reaches theirs.</p><a className="button primary" href={signInPath('/')}>Sign in to read together<ArrowUpRight size={14}/></a><button type="button" className="text-button" onClick={onExplore}>Explore the community</button></div> : <>
        {loading && !room ? <div className={styles.loading} role="status"><LoaderCircle size={22} className="spin"/><p>Finding company at your bookmark…</p></div> : null}
        {loadError ? <div className={styles.error} role="alert"><p>{loadError}</p><button type="button" className="button secondary" onClick={() => void refresh()}>Try again<RefreshCw size={14}/></button></div> : null}
        {!loading && !loadError && room && !shown.length ? <div className={styles.empty}><MessageCircle size={30} strokeWidth={1.2}/><h2>{room.waitingCount ? 'A little more story, a little more company.' : room.followingCount ? 'The margins are open.' : 'Good company starts with a follow.'}</h2><p>{room.waitingCount ? 'Your circle has thoughts further into this book. They’ll appear as you move your bookmark. You can leave a thought at your own place now.' : room.followingCount ? 'No shared thoughts at your bookmark yet. Leave the first one, or come back as your circle reads along.' : 'Visit readers’ profiles from Explore and follow them. Their shared thoughts about this book will gather here at your pace.'}</p>{!room.followingCount ? <button type="button" className="button secondary" onClick={onExplore}>Find your kind of reader<ArrowUpRight size={14}/></button> : null}</div> : null}
        <div className={styles.stream}>{shown.map(post => <Thought key={post.id} post={post} bookId={book.id} accountId={accountId} ceiling={protectedProgress} ready={ready && !saving && !posting} refreshTick={refreshTick} onChanged={() => void refresh(true)} flush={flush}/>)}</div>
        {room?.nextCursor ? <div className={styles.more}><button type="button" className="button secondary" onClick={() => void more()} disabled={loadingMore || loading || !ready}>{loadingMore ? <LoaderCircle className="spin" size={15}/> : <ChevronDown size={15}/>}More thoughts at your bookmark</button></div> : null}
        {room && room.waitingCount > 0 && shown.length > 0 ? <div className={styles.waiting}><LockKeyhole size={18}/><div><strong>{room.waitingCount.toLocaleString()} {room.waitingCount === 1 ? 'thought is' : 'thoughts are'} waiting further along.</strong><p>They’ll meet you when you get there.</p></div></div> : null}
        {room ? <p className={styles.refreshNote}><span/>Updates here refresh while this page is open. Only explicitly shared thoughts appear.</p> : null}
      </>}
      </div>}
    </div>
  </div>;
}

function Thought({ post, bookId, accountId, ceiling, ready, refreshTick, onChanged, flush }: {
  post: ReadingPost; bookId: string; accountId: string; ceiling: number; ready: boolean; refreshTick: number;
  onChanged: () => void; flush: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [thread, setThread] = useState<ReadingRoomCommentsResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState<{ tick: number; ceiling: number } | null>(null);
  const [body, setBody] = useState(''), [replyAt, setReplyAt] = useState<'thought' | 'bookmark'>('thought');
  const [busy, setBusy] = useState(false), [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const active = useRef(true), sequence = useRef(0);
  const path = `/api/reading-room/${encodeURIComponent(post.id)}/comments?bookId=${encodeURIComponent(bookId)}`;
  useEffect(() => { active.current = true; return () => { active.current = false; sequence.current++; }; }, []);
  useEffect(() => {
    if (!open || !ready) return;
    const controller = new AbortController(), generation = ++sequence.current;
    setLoading(true); setError(''); setThread(null); setLoadedAt(null);
    void roomRequest<ReadingRoomCommentsResponse>(path, accountId, { signal: controller.signal }).then(result => {
      if (active.current && generation === sequence.current) { setThread(result); setLoadedAt({ tick: refreshTick, ceiling }); }
    }).catch(reason => {
      if (active.current && generation === sequence.current && !controller.signal.aborted) { setThread(null); setError(reason instanceof Error ? reason.message : 'Replies could not be loaded.'); }
    }).finally(() => { if (active.current && generation === sequence.current) setLoading(false); });
    return () => { sequence.current++; controller.abort(); };
  }, [open, ready, path, accountId, refreshTick, ceiling]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!ready || busy || !body.trim()) return;
    const marker = replyAt === 'bookmark' ? ceiling : post.entry.progress;
    if (!Number.isFinite(marker) || marker < post.entry.progress || marker > ceiling) { setError('This conversation has moved beyond your bookmark. Refresh before replying.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await flush(); if (!active.current) return;
      const result = await roomRequest<{ comment: ReadingComment }>(path, accountId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body.trim(), progress: marker }) });
      if (!active.current) return;
      setThread(previous => previous ? { ...previous, comments: [...previous.comments.filter(comment => comment.id !== result.comment.id), result.comment] } : null);
      setBody(''); setNotice('Your reply is shared.'); onChanged();
    } catch (reason) { if (active.current) {
      setError(reason instanceof Error ? reason.message : 'Your reply could not be shared.');
      if (reason instanceof RoomRequestError && [401, 403, 404, 409].includes(reason.status)) { setThread(null); setLoadedAt(null); onChanged(); }
    } }
    finally { if (active.current) setBusy(false); }
  };
  const remove = async (commentId: string) => {
    if (!ready || busy) return; setBusy(true); setError('');
    try {
      await roomRequest(`/api/journal/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}`, accountId, { method: 'DELETE' });
      if (!active.current) return;
      setThread(previous => previous ? { ...previous, comments: previous.comments.filter(comment => comment.id !== commentId) } : null);
      setDeleting(null); setNotice('Reply removed.'); onChanged();
    } catch (reason) { if (active.current) {
      setError(reason instanceof Error ? reason.message : 'Your reply could not be removed.');
      if (reason instanceof RoomRequestError && [401, 403, 404, 409].includes(reason.status)) { setThread(null); setLoadedAt(null); onChanged(); }
    } }
    finally { if (active.current) setBusy(false); }
  };

  // A refreshed parent invalidates its expanded replies in the same render,
  // before the next effect runs. Keep the typed draft, never a stale reply body.
  const visibleThread = ready && loadedAt?.tick === refreshTick && loadedAt.ceiling === ceiling ? thread : null;
  const comments = visibleThread?.comments.filter(comment => comment.progress <= Math.min(ceiling, visibleThread.reader.progress)) ?? [];
  return <article className={styles.thought}>
    <div className={styles.thoughtHeader}><a className={styles.avatar} href={'/u/' + encodeURIComponent(post.profileId)} aria-label={`Visit ${post.name}’s profile`}>{post.name.slice(0, 1).toUpperCase()}</a><div><a href={'/u/' + encodeURIComponent(post.profileId)}>{post.name}</a><time dateTime={post.entry.createdAt}>{readingDate(post.entry.createdAt)}</time></div><span className={styles.thoughtMarker}>{readingMarker(post.entry)}</span></div>
    {post.entry.body ? <p className={styles.thoughtBody}>{post.entry.body}</p> : <p className={styles.milestone}>{post.entry.progress === 100 ? 'Finished this book.' : post.entry.progress === 0 ? 'Started a new reading journey.' : `A new bookmark at ${percentage(post.entry.progress)}%.`}</p>}
    <button type="button" className={styles.openReplies} aria-expanded={open} aria-controls={'room-replies-' + post.id} onClick={() => { if (!open) { setThread(null); setLoadedAt(null); } setOpen(value => !value); }}><MessageCircle size={15}/>{post.commentCount ? `${post.commentCount} ${post.commentCount === 1 ? 'reply' : 'replies'} at your bookmark` : 'Leave a reply'}<ChevronDown size={14} className={open ? styles.chevronOpen : ''}/></button>
    {open ? <section className={styles.replies} id={'room-replies-' + post.id} aria-label={'Replies to ' + post.name}>
      {loading && !visibleThread ? <p className={styles.replyStatus} role="status"><LoaderCircle size={14} className="spin"/>Opening replies at your bookmark…</p> : null}
      {comments.map(comment => <article key={comment.id} className={styles.reply}>
        <header><strong>{comment.profileId ? <a href={'/u/' + encodeURIComponent(comment.profileId)}>{comment.name}</a> : comment.name}</strong><span>{percentage(comment.progress)}%</span><time dateTime={comment.createdAt}>{readingDate(comment.createdAt)}</time></header><p>{comment.body}</p>
        {comment.canDelete ? <div className={styles.deleteReply}>{deleting === comment.id ? <><button type="button" className="text-button danger-text" disabled={busy || !ready} onClick={() => void remove(comment.id)}>Remove reply</button><button type="button" className="text-button" disabled={busy} onClick={() => setDeleting(null)}>Keep it</button></> : <button type="button" className="text-button" aria-label={'Remove reply by ' + comment.name} disabled={busy || !ready} onClick={() => setDeleting(comment.id)}><Trash2 size={12}/>Remove</button>}</div> : null}
      </article>)}
      {visibleThread && visibleThread.waitingCount > 0 ? <p className={styles.replyStatus}><LockKeyhole size={12}/>{visibleThread.waitingCount === 1 ? 'A later reply is' : 'Later replies are'} waiting beyond your bookmark.</p> : null}
      <form className={styles.replyForm} onSubmit={event => void submit(event)}><label><span>Meet them at {percentage(post.entry.progress)}%</span><textarea rows={3} value={body} onChange={event => setBody(event.target.value)} maxLength={4000} required disabled={!ready || busy || loading} placeholder="A little company, without giving away what comes next…"/></label><div className={styles.replyControls}><label>Discusses events up to <select aria-label={'Reply marker for ' + post.name} value={replyAt} onChange={event => setReplyAt(event.target.value as 'thought' | 'bookmark')} disabled={!ready || busy || loading}><option value="thought">This thought · {percentage(post.entry.progress)}%</option><option value="bookmark">My bookmark · {percentage(ceiling)}%</option></select></label><button className="button primary small" disabled={!ready || busy || loading || !body.trim() || !visibleThread}>{busy ? <LoaderCircle size={14} className="spin"/> : <Send size={14}/>}Share reply</button></div><p className={styles.replyHelp}>If you mention later events, choose your own bookmark so the reply stays hidden until readers catch up. Your name and reply are public while this thought is shared.</p></form>
      {error ? <div className={styles.inlineError} role="alert"><p>{error}</p>{!thread ? <button type="button" className="text-button" onClick={onChanged}>Try again</button> : null}</div> : null}
      {notice ? <p className={styles.replyStatus} role="status"><Check size={13}/>{notice}</p> : null}
    </section> : null}
  </article>;
}
