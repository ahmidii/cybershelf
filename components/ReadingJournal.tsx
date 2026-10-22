'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, Globe, LoaderCircle, LockKeyhole, MessageCircle, PenLine, Plus, Trash2, UsersRound } from 'lucide-react';
import type { AppState, Book, ReadingPost } from '@/lib/types';
import { uid } from '@/lib/types';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { appendReadingEntry, makeReadingEntry, readingMarker, READING_LOG_LIMIT, READING_THOUGHT_LIMIT } from '@/lib/reading-log';
import BookCover from './BookCover';
import styles from './ReadingJournal.module.css';

interface Props {
  state: AppState;
  update: (updater: (current: AppState) => AppState) => void;
  accountId: string | null;
  ready: boolean;
  flush: () => Promise<void>;
  onBookOpen: (bookId: string) => void;
  onOpenProfile: () => void;
  notify: (message: string) => void;
  initialBookId?: string;
  onReadTogether?: (bookId: string) => void;
  embeddedBookId?: string;
  refreshKey?: number;
  onSharingChanged?: (published: boolean) => void;
}
interface SharedEntry { id: string; bookId: string; entryId: string; published: boolean; publishedAt: string; }
interface SharingState { posts: SharedEntry[]; profileId?: string; }
interface Draft { body: string; mode: 'page' | 'percent'; marker: string; progress?: string; }

function startingDraft(book: Book): Draft {
  return book.pages && book.pages > 0
    ? { body: '', mode: 'page', marker: String(Math.round(book.pages * book.progress / 100)) }
    : { body: '', mode: 'percent', marker: String(book.progress), progress: String(book.progress) };
}
async function jsonRequest<T>(url: string, accountId: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...options,
    headers: { [ACCOUNT_ID_HEADER]: accountId, ...options.headers },
  });
  const data = response.status === 204 ? {} : await response.json() as { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error || 'This update could not be saved. Please try again.');
  return data as T;
}

export default function ReadingJournal({ state, update, accountId, ready, flush, onBookOpen, onOpenProfile, notify, initialBookId, onReadTogether, embeddedBookId, refreshKey, onSharingChanged }: Props) {
  const firstBook = state.books.find(book => book.id === (embeddedBookId ?? initialBookId)) ?? state.books.find(book => book.status === 'reading') ?? state.books[0];
  const [bookId, setBookId] = useState(firstBook?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [sharing, setSharing] = useState<SharingState>({ posts: [] });
  const [sharingLoaded, setSharingLoaded] = useState(!accountId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sharingError, setSharingError] = useState('');
  const [prompt, setPrompt] = useState<'profile' | 'signin' | null>(null);
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(40);
  const [editing, setEditing] = useState<string | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const current = useRef(state); current.current = state;
  const active = useRef(true), session = useRef({ accountId, ready }); session.current = { accountId, ready };
  const isCurrent = () => active.current && session.current.accountId === accountId && session.current.ready;
  const selected = state.books.find(book => book.id === bookId) ?? firstBook;
  const draft = selected ? drafts[selected.id] ?? startingDraft(selected) : undefined;
  const entries = useMemo(() => state.books.flatMap(book => (book.readingLog ?? []).map(entry => ({ book, entry }))).sort((left, right) => Date.parse(right.entry.createdAt) - Date.parse(left.entry.createdAt) || right.entry.id.localeCompare(left.entry.id)), [state.books]);
  const shown = entries.filter(item => embeddedBookId ? item.book.id === embeddedBookId : filter === 'all' || item.book.id === filter);
  const shared = useMemo(() => new Map(sharing.posts.map(post => [post.entryId, post])), [sharing.posts]);

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (initialBookId) setBookId(initialBookId); }, [initialBookId]);
  useEffect(() => {
    if (!accountId || !ready) { setSharing({ posts: [] }); setSharingLoaded(!accountId); return; }
    setSharingLoaded(false);
    let active = true;
    void jsonRequest<SharingState>('/api/journal', accountId).then(result => {
      if (active) { setSharing(result); setSharingLoaded(true); setSharingError(''); }
    }).catch(error => { if (active) setSharingError(error instanceof Error ? error.message : 'Sharing status is unavailable. Your private journal remains available.'); });
    return () => { active = false; };
  }, [accountId, ready, refreshKey, embeddedBookId]);

  const setDraft = (patch: Partial<Draft>) => {
    if (!selected || !draft) return;
    setDrafts(previous => ({ ...previous, [selected.id]: { ...draft, ...patch } }));
  };
  const changeMode = (mode: Draft['mode']) => {
    if (!selected || !draft || mode === draft.mode) return;
    const number = Number(draft.marker);
    const progress = draft.mode === 'page' && selected.pages ? number / selected.pages * 100 : draft.mode === 'percent' ? number : Number(draft.progress ?? selected.progress);
    setDraft({ mode, progress: String(Number.isFinite(progress) ? progress : selected.progress), marker: String(mode === 'percent' ? Math.round(Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : selected.progress)) * 10) / 10 : selected.pages ? Math.round(selected.pages * progress / 100) : 0) });
  };
  const refreshSharing = async () => {
    if (!accountId) return { posts: [] } as SharingState;
    const result = await jsonRequest<SharingState>('/api/journal', accountId);
    if (!isCurrent()) throw new Error('This reading view has changed. Reopen the book to continue.');
    setSharing(result); setSharingLoaded(true); setSharingError(''); return result;
  };
  const publishSavedEntry = async (selectedBookId: string, entryId: string) => {
    if (!accountId) { setPrompt('signin'); notify('Saved in your private journal. Sign in to share it.'); return; }
    await flush();
    if (!isCurrent()) return;
    const status = await refreshSharing();
    if (!isCurrent()) return;
    if (!status.profileId) { setPrompt('profile'); notify('Saved privately. Publish your profile before sharing this update.'); return; }
    const result = await jsonRequest<{ post: ReadingPost }>('/api/journal', accountId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: selectedBookId, entryId }),
    });
    if (!isCurrent()) return;
    setSharing(previous => ({ profileId: result.post.profileId, posts: [...previous.posts.filter(post => post.entryId !== entryId), { id: result.post.id, bookId: selectedBookId, entryId, published: true, publishedAt: result.post.publishedAt }] }));
    setSharingLoaded(true);
    setPrompt(null); notify('Reading update shared on your profile.'); onSharingChanged?.(true);
  };
  const save = async (share: boolean) => {
    if (!selected || !draft || !ready || busy) return;
    setError(''); setPrompt(null);
    try {
      const book = current.current.books.find(book => book.id === selected.id);
      if (!book) throw new Error('Choose a book from your library.');
      const entry = makeReadingEntry(book, draft, { id: uid('log_'), createdAt: new Date().toISOString() });
      if ((book.readingLog?.length ?? 0) >= READING_LOG_LIMIT) throw new Error('This book has 200 updates. Export a backup, then remove an older update to make room.');
      setBusy('composer');
      update(state => appendReadingEntry(state, book.id, entry));
      setDrafts(previous => ({ ...previous, [book.id]: { ...draft, body: '' } }));
      if (share) await publishSavedEntry(book.id, entry.id);
      else { await flush(); if (isCurrent()) notify(accountId ? 'Reading update saved privately.' : 'Reading update added to your private browser draft.'); }
    } catch (error) { if (isCurrent()) setError(error instanceof Error ? error.message : 'Your update could not be saved.'); }
    finally { if (active.current) setBusy(null); }
  };
  const shareEntry = async (selectedBookId: string, entryId: string) => {
    if (busy || !ready) return;
    setBusy(entryId); setError(''); setPrompt(null);
    try { await publishSavedEntry(selectedBookId, entryId); }
    catch (error) { if (isCurrent()) setError(error instanceof Error ? error.message : 'Could not share this entry. It stays in your private journal.'); }
    finally { if (active.current) setBusy(null); }
  };
  const unpublish = async (post: SharedEntry) => {
    if (!accountId) throw new Error('Sign in to manage shared updates.');
    await jsonRequest(`/api/journal/${encodeURIComponent(post.id)}`, accountId, { method: 'DELETE' });
    if (!isCurrent()) return;
    setSharing(previous => ({ ...previous, posts: previous.posts.map(entry => entry.id === post.id ? { ...entry, published: false } : entry) }));
    onSharingChanged?.(false);
  };
  const unshareEntry = async (post: SharedEntry) => {
    if (busy || !ready) return;
    setBusy(post.entryId); setError('');
    try { await unpublish(post); if (isCurrent()) notify('This update is private again.'); }
    catch (error) { if (isCurrent()) setError(error instanceof Error ? error.message : 'Could not unshare this update.'); }
    finally { if (active.current) setBusy(null); }
  };
  const saveThought = async (selectedBookId: string, entryId: string) => {
    if (busy || !ready) return;
    setBusy(entryId); setError('');
    try {
      if (editedBody.length > READING_THOUGHT_LIMIT) throw new Error('Keep a thought to 4,000 characters.');
      update(state => ({ ...state, books: state.books.map(book => book.id === selectedBookId ? { ...book, readingLog: book.readingLog?.map(entry => entry.id === entryId ? { ...entry, body: editedBody.trim() } : entry) } : book) }));
      await flush(); if (!isCurrent()) return; setEditing(null);
      notify(shared.get(entryId)?.published ? 'Thought saved privately. Update the shared entry when you are ready.' : 'Thought saved privately.');
    } catch (error) { if (isCurrent()) setError(error instanceof Error ? error.message : 'Could not save this thought.'); }
    finally { if (active.current) setBusy(null); }
  };
  const removeEntry = async (selectedBookId: string, entryId: string) => {
    if (busy || !ready) return;
    setBusy(entryId); setError('');
    try {
      const latestSharing = accountId ? await refreshSharing() : sharing;
      if (!isCurrent()) return;
      const post = latestSharing.posts.find(post => post.entryId === entryId);
      if (post?.published) await unpublish(post);
      if (!isCurrent()) return;
      update(state => ({ ...state, books: state.books.map(book => book.id === selectedBookId ? { ...book, readingLog: book.readingLog?.filter(entry => entry.id !== entryId) } : book) }));
      await flush(); if (!isCurrent()) return; setConfirmDelete(null); notify('Reading update removed. Your current reading progress is unchanged.');
    } catch (error) { if (isCurrent()) setError(error instanceof Error ? error.message : 'Could not remove this update.'); }
    finally { if (active.current) setBusy(null); }
  };

  return <section className={`${styles.journal} ${embeddedBookId ? styles.embedded : ''}`} aria-label="Your reading journal">
    {!embeddedBookId && <><header className="page-heading"><div><p className="eyebrow">YOUR READING LIFE</p><h1>Along the way.</h1><p className="page-description">Keep a thought where you found it. Share the moments you want company for.</p></div></header>
    <div className={styles.summary}><span><strong>{state.books.filter(book => book.status === 'reading').length}</strong> in progress</span><span><strong>{state.books.filter(book => book.status === 'read').length}</strong> finished</span><span><strong>{entries.length}</strong> reading updates</span></div>
    {selected && draft ? <div className={styles.composer}>
      <div className={styles.composerHeading}><PenLine size={20}/><div><h2>Leave a little bookmark.</h2><p>A thought is optional. Your place in the book is enough.</p></div></div>
      <div className={styles.bookChooser}><button type="button" className={styles.coverButton} onClick={() => onBookOpen(selected.id)} aria-label={`Open ${selected.title}`}><BookCover book={selected} small/></button><label className="field">What are you reading?<select value={selected.id} disabled={!ready || !!busy} onChange={event => { setBookId(event.target.value); setError(''); }}>{state.books.map(book => <option key={book.id} value={book.id}>{book.title} — {book.author}</option>)}</select></label></div>
      {onReadTogether && <button type="button" className={styles.togetherLink} onClick={() => onReadTogether(selected.id)}><UsersRound size={15}/><span>Read this book with your circle</span><ArrowUpRight size={13}/></button>}
      <div className={styles.markerRow}><div className={styles.modeSwitch} role="group" aria-label="Reading progress format"><button type="button" aria-pressed={draft.mode === 'page'} onClick={() => changeMode('page')} disabled={!!busy}>Page</button><button type="button" aria-pressed={draft.mode === 'percent'} onClick={() => changeMode('percent')} disabled={!!busy}>Percentage</button></div><label className={styles.markerInput}><span>{draft.mode === 'page' ? 'Page reached' : 'Percentage read'}</span><input aria-label={draft.mode === 'page' ? 'Page reached' : 'Percentage read'} type="number" inputMode="decimal" min="0" max={draft.mode === 'percent' ? 100 : selected.pages || 100000} step={draft.mode === 'page' ? 1 : .1} value={draft.marker} disabled={!!busy} onChange={event => setDraft({ marker: event.target.value })}/><span>{draft.mode === 'page' ? selected.pages ? `of ${selected.pages.toLocaleString()}` : 'pages' : '%'}</span></label></div>
      {draft.mode === 'page' && !selected.pages && <label className={styles.unknownProgress}>Progress at this page<input aria-label="Progress percentage at this page" type="number" min="0" max="100" step="0.1" value={draft.progress ?? String(selected.progress)} onChange={event => setDraft({ progress: event.target.value })} disabled={!!busy}/><span>%</span></label>}
      <p className={styles.progressHint}>{draft.mode === 'page' ? selected.pages ? `Calculated using the ${selected.pages.toLocaleString()} pages saved for this book. Adjust the page count in Book details if your copy differs.` : 'This edition’s page count is unknown. Set an approximate percentage as well, so readers know how far the thought reaches.' : 'This percentage stays with the entry, even as you read further.'}</p>
      <label className={styles.thoughtLabel}>A thought to keep <span>optional</span><textarea rows={4} maxLength={READING_THOUGHT_LIMIT} value={draft.body} disabled={!!busy} onChange={event => setDraft({ body: event.target.value })} placeholder="A sentence that stayed with you, a theory, a change of heart…"/></label>
      <div className={styles.composerFooter}><span>{draft.body.length.toLocaleString()} / 4,000</span><div><button type="button" className="button secondary" disabled={!ready || !!busy} onClick={() => void save(false)}>{busy === 'composer' ? <LoaderCircle size={15} className="spin"/> : <LockKeyhole size={15}/>}Save privately</button><button type="button" className="button primary" disabled={!ready || !!busy} onClick={() => void save(true)}><Globe size={15}/>Share update</button></div></div>
      <p className={styles.privacy}><LockKeyhole size={13}/>Only entries you share become public. Sharing includes this thought, its book, progress, and date, and opens it for comments. Your other notes and reviews stay private.</p>
    </div> : <div className={styles.empty}><BookOpen size={32} strokeWidth={1.3}/><h2>A reading life starts with a book.</h2><p>Add a book to your library, then return here to save your place and your thoughts.</p></div>}</>}
    {prompt && <div className={styles.prompt} role="status"><div><strong>Your entry is saved privately.</strong><p>{prompt === 'signin' ? 'Sign in to save across devices and share selected reading updates.' : 'Publish a profile with your featured shelf, then share this entry from your journal.'}</p></div>{prompt === 'signin' ? <a className="button primary" href={signInPath()}>Sign in <ArrowUpRight size={15}/></a> : <button type="button" className="button primary" onClick={onOpenProfile}>Open my profile <ArrowUpRight size={15}/></button>}</div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {sharingError && <div className={styles.statusError}><p>{sharingError}</p><button type="button" className="text-button" onClick={() => void refreshSharing().catch(error => setSharingError(error instanceof Error ? error.message : 'Sharing status is unavailable.'))}>Refresh sharing status</button></div>}
    <div className={styles.timelineHeading}><div><p className="eyebrow">YOUR BOOKMARKS</p><h2>{embeddedBookId ? 'Your saved moments.' : 'Thoughts, in their own time.'}</h2>{embeddedBookId && <p className={styles.historyHelp}>Your private and shared entries for this book. Only entries you choose to share appear in your circle.</p>}</div>{!embeddedBookId && entries.length > 0 && <label className={styles.filter}><span className="sr-only">Filter journal by book</span><select value={filter} onChange={event => { setFilter(event.target.value); setLimit(40); }}><option value="all">All books</option>{state.books.filter(book => book.readingLog?.length).map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>}</div>
    {shown.length === 0 ? <div className={styles.emptyTimeline}><Plus size={24}/><p>Your first reading update will appear here. Save a page, a percentage, or a thought above.</p></div> : <div className={styles.timeline}>
      {shown.slice(0, limit).map(({ book, entry }) => {
        const post = shared.get(entry.id), published = post?.published === true, saving = busy === entry.id;
        return <article className={styles.entry} key={entry.id}>
          <div className={styles.entryTop}><button type="button" className={styles.entryBook} onClick={() => onBookOpen(book.id)}><BookCover book={book} small/><span><strong>{book.title}</strong><small>{book.author}</small></span></button><span className={`${styles.visibility} ${published ? styles.public : ''}`}>{!sharingLoaded ? <Globe size={12}/> : published ? <Globe size={12}/> : <LockKeyhole size={12}/>} {!sharingLoaded ? sharingError ? 'Status unavailable' : 'Checking sharing' : published ? 'Shared' : 'Private'}</span></div>
          <div className={styles.entryMeta}><span>{readingMarker(entry)}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time></div>
          {editing === entry.id ? <div className={styles.editThought}><label className="field">Your thought<textarea rows={4} maxLength={READING_THOUGHT_LIMIT} value={editedBody} onChange={event => setEditedBody(event.target.value)}/></label><div className="button-row"><button type="button" className="button primary small" disabled={!!busy} onClick={() => void saveThought(book.id, entry.id)}>{saving ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}Save thought</button><button type="button" className="button quiet small" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button></div>{published && <p>Changes stay private until you update the shared entry.</p>}</div> : entry.body ? <p className={styles.entryBody}>{entry.body}</p> : <p className={styles.progressOnly}>A little further into this story.</p>}
          <div className={styles.entryActions}>
            <button type="button" className="text-button" disabled={!ready || !!busy} onClick={() => void shareEntry(book.id, entry.id)}>{saving ? <LoaderCircle className="spin" size={14}/> : <Globe size={14}/>} {published ? 'Update shared entry' : 'Share to profile'}</button>
            {published && post && <>{embeddedBookId && onReadTogether ? <button type="button" className="text-button" onClick={() => onReadTogether(book.id)}><MessageCircle size={14}/>Replies in your circle<ArrowUpRight size={12}/></button> : <a className="text-button" href={`/j/${encodeURIComponent(post.id)}`} target="_blank" rel="noreferrer"><MessageCircle size={14}/>Open discussion <ArrowUpRight size={12}/></a>}<button type="button" className="text-button" disabled={!ready || !!busy} onClick={() => void unshareEntry(post)}>Unshare</button></>}
            <span className={styles.actionSpacer}/><button type="button" className="icon-button" disabled={!ready || !!busy} aria-label={`Edit thought for ${book.title} at ${readingMarker(entry)}`} onClick={() => { setEditing(entry.id); setEditedBody(entry.body); }}><PenLine size={15}/></button><button type="button" className="icon-button" disabled={!ready || !!busy} aria-label={`Remove reading update for ${book.title}`} onClick={() => setConfirmDelete(entry.id)}><Trash2 size={15}/></button>
          </div>
          {confirmDelete === entry.id && <div className={styles.deleteConfirm}><p>{!sharingLoaded ? 'Remove this update? Any public copy will be unshared first.' : published ? 'Remove this update from your private journal and unshare its public discussion?' : 'Remove this reading update? Your current reading progress stays the same.'}</p><div className="button-row"><button type="button" className="button danger small" disabled={!!busy} onClick={() => void removeEntry(book.id, entry.id)}>Remove update</button><button type="button" className="button quiet small" disabled={!!busy} onClick={() => setConfirmDelete(null)}>Keep it</button></div></div>}
        </article>;
      })}
      {shown.length > limit && <button type="button" className="button secondary" onClick={() => setLimit(value => value + 40)}>Show older updates</button>}
    </div>}
    {!embeddedBookId && <section className={styles.legacy}><div><h2>Reviews & private notes</h2><p>Your existing journal is still here. Open a book to revisit its review, rating, and notes.</p></div><div className={styles.legacyBooks}>{state.books.filter(book => book.review || book.notes || book.rating).slice(0, 12).map(book => <button type="button" key={book.id} onClick={() => onBookOpen(book.id)}><BookCover book={book} small/><span>{book.title}</span><ArrowUpRight size={14}/></button>)}{!state.books.some(book => book.review || book.notes || book.rating) && <p>Notes and reviews are available inside every book.</p>}</div></section>}
    {embeddedBookId && <button type="button" className={styles.bookNotes} onClick={() => onBookOpen(embeddedBookId)}><BookOpen size={15}/>Review, rating & private notes<ArrowUpRight size={13}/></button>}
  </section>;
}
