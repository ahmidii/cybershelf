'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, LoaderCircle, MessageCircle, Send, ShieldCheck, Trash2 } from 'lucide-react';
import type { Book, ReadingComment, ReadingPost, StateResponse } from '@/lib/types';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { progressLabel, readerPosition, readingDate } from '@/lib/reading';
import BookCover from './BookCover';
import BrandWordmark from './BrandWordmark';
import SpoilerText from './SpoilerText';
import styles from './ReadingConversation.module.css';

interface Thread { post: ReadingPost; comments: ReadingComment[]; viewer: { accountId: string | null; canModerate: boolean }; }

async function getThread(id: string, signal?: AbortSignal): Promise<Thread> {
  const response = await fetch('/api/journal/' + encodeURIComponent(id), { cache: 'no-store', signal });
  const result = await response.json() as Thread & { error?: string };
  if (!response.ok) throw new Error(result.error || 'This conversation could not be opened.');
  return result;
}

export default function ReadingThread({ id }: { id: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [body, setBody] = useState(''), [replyProgress, setReplyProgress] = useState('');
  const [position, setPosition] = useState<number | null>(null), [protect, setProtect] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [checkingViewer, setCheckingViewer] = useState(true);
  const viewer = useRef<string | null | undefined>(undefined), viewerEpoch = useRef(0);
  const visitedFragment = useRef('');

  useEffect(() => {
    let controller: AbortController | null = null, sequence = 0, active = true;
    const refresh = async () => {
      if (controller) return; // Focus and visibility often arrive together.
      controller = new AbortController();
      const request = controller, generation = ++sequence;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
      const current = () => active && generation === sequence && !request.signal.aborted;
      setCheckingViewer(true); setBooks([]);
      try {
        const result = await getThread(id, signal);
        if (!current()) return;
        const changed = viewer.current !== undefined && viewer.current !== result.viewer.accountId;
        if (changed) {
          viewerEpoch.current++; setBody(''); setPosition(null); setProtect(true);
          setError(''); setNotice(''); setDeleting(null); setBusy(false);
        }
        if (changed || viewer.current === undefined) setReplyProgress(String(result.post.entry.progress));
        viewer.current = result.viewer.accountId;
        setThread(result); setLoadError(''); setLoading(false);
        if (result.viewer.accountId) {
          const response = await fetch('/api/state', { cache: 'no-store', signal, headers: { [ACCOUNT_ID_HEADER]: result.viewer.accountId } });
          if (response.status === 401 || response.status === 409) throw new Error('Your account changed during this check. Refresh the conversation to continue.');
          if (response.ok) {
            const library = await response.json() as StateResponse;
            if (library.user.id !== result.viewer.accountId) throw new Error('Your account changed during this check. Refresh the conversation to continue.');
            if (current()) setBooks(library.state?.books ?? []);
          }
        }
      } catch (reason) {
        if (current()) setLoadError(reason instanceof Error ? reason.message : 'Please refresh the conversation.');
      } finally {
        if (current()) { setCheckingViewer(false); setLoading(false); controller = null; }
      }
    };
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
      else { sequence++; controller?.abort(); controller = null; setCheckingViewer(true); setBooks([]); }
    };
    setLoading(true); setLoadError(''); setThread(null); void refresh();
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisibility);
    return () => { active = false; sequence++; controller?.abort(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, [id, retry]);

  useEffect(() => {
    if (!thread || checkingViewer) return;
    const visitReply = () => {
      try {
        const target = decodeURIComponent(window.location.hash.slice(1));
        if (target.startsWith('comment-')) document.getElementById(target)?.scrollIntoView({ block: 'center' });
        visitedFragment.current = thread.post.id + window.location.hash;
      } catch { /* Malformed fragment URLs do not affect the conversation. */ }
    };
    if (visitedFragment.current !== thread.post.id + window.location.hash) visitReply();
    window.addEventListener('hashchange', visitReply);
    return () => window.removeEventListener('hashchange', visitReply);
  }, [thread?.post.id, checkingViewer]);

  const known = thread ? readerPosition(thread.post.book, books) : { progress: 0, unread: true };
  const readerProgress = position ?? known.progress;
  const unread = position === null ? known.unread : position === 0;
  const returnPath = '/j/' + encodeURIComponent(id);

  async function reply(event: React.FormEvent) {
    event.preventDefault();
    if (!thread?.viewer.accountId || busy || checkingViewer) return;
    const accountId = thread.viewer.accountId, epoch = viewerEpoch.current;
    const current = () => viewer.current === accountId && viewerEpoch.current === epoch;
    const progress = Number(replyProgress);
    if (!replyProgress.trim() || !Number.isFinite(progress) || progress < thread.post.entry.progress || progress > 100) {
      setError(`Choose a reply marker from ${thread.post.entry.progress}% to 100%.`); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/journal/' + encodeURIComponent(id) + '/comments', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: thread.viewer.accountId },
        body: JSON.stringify({ body: body.trim(), progress }),
      });
      const result = await response.json() as { comment?: ReadingComment; error?: string };
      if (!current()) return;
      if (!response.ok || !result.comment) throw new Error(result.error || 'Your reply could not be shared.');
      const comment = result.comment;
      setThread(current => current && current.post.id === id && !current.comments.some(item => item.id === comment.id) ? { ...current, comments: [...current.comments, comment], post: { ...current.post, commentCount: current.post.commentCount + 1 } } : current);
      setBody(''); setNotice('Your reply has joined the conversation.');
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : 'Your reply could not be shared.'); }
    finally { if (current()) setBusy(false); }
  }

  async function removeComment(comment: ReadingComment) {
    if (!thread?.viewer.accountId || busy || checkingViewer) return;
    const accountId = thread.viewer.accountId, epoch = viewerEpoch.current;
    const current = () => viewer.current === accountId && viewerEpoch.current === epoch;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/journal/' + encodeURIComponent(id) + '/comments/' + encodeURIComponent(comment.id), {
        method: 'DELETE', signal: AbortSignal.timeout(15000), headers: { [ACCOUNT_ID_HEADER]: thread.viewer.accountId },
      });
      if (!current()) return;
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || 'This reply could not be removed.'); }
      setThread(current => current && current.post.id === id ? { ...current, comments: current.comments.filter(item => item.id !== comment.id), post: { ...current.post, commentCount: Math.max(0, current.post.commentCount - 1) } } : current);
      setDeleting(null); setNotice('Reply removed.');
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { if (current()) setBusy(false); }
  }

  return <div className={styles.page}>
    <header className={styles.siteHeader}><a href="/" className={styles.brand}><BrandWordmark/></a><a href="/" className={styles.homeLink}>Your reading corner <ArrowUpRight size={15}/></a></header>
    <main className={styles.threadMain}>
      {loading ? <div className={styles.pageState} aria-busy="true"><LoaderCircle className="spin" size={24}/><p>Opening a moment in a reading life…</p></div> : loadError ? <div className={styles.pageState}><BookOpen size={30}/><h1>This page is quiet.</h1><p>{loadError}</p><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Try again</button><a href="/" className="text-button">Back to cybershelf <ArrowUpRight size={14}/></a></div> : thread ? <>
        <a className={styles.backLink} href={'/u/' + encodeURIComponent(thread.post.profileId)}><ArrowLeft size={14}/> {thread.post.name}’s reading life</a>
        <section className={styles.bookHeading}><BookCover book={thread.post.book}/><div><p className={styles.eyebrow}>A reading conversation</p><h1>{thread.post.book.title}</h1><p>{thread.post.book.author}</p><span className={styles.marker}>{progressLabel(thread.post.entry.progress, thread.post.entry.page)}</span></div></section>
        <section className={styles.guard} aria-label="Spoiler preferences">
          <div className={styles.guardTitle}><ShieldCheck size={18}/><div><strong>Read at your own pace</strong><p>Thoughts beyond your place stay hidden. Progress is compared by percentage because editions can have different pages.</p></div></div>
          <div className={styles.guardControls}><label>Your place <span><input type="number" min="0" max="100" step="0.1" value={checkingViewer ? '' : readerProgress} disabled={checkingViewer} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setPosition(Math.min(100, Math.max(0, value))); }}/> %</span></label><label className={styles.check}><input type="checkbox" checked={checkingViewer || protect} disabled={checkingViewer} onChange={event => setProtect(event.target.checked)}/>Hide thoughts ahead of me</label>{position !== null && !checkingViewer && <button className="text-button" onClick={() => setPosition(null)}>Use my saved progress</button>}</div>
          <p className={styles.help}>{checkingViewer ? 'Checking your account and reading progress…' : position !== null ? 'This changes the view here; your saved reading progress stays as it is.' : known.unread ? 'No reading progress found for this book. Choose your place above, or reveal an individual thought.' : `Using ${known.progress}% from your library.`} Markers depend on what readers choose to share.</p>
        </section>
        <article className={styles.thought}>
          <header className={styles.entryHeader}><a href={'/u/' + encodeURIComponent(thread.post.profileId)}>{thread.post.name}</a><time dateTime={thread.post.entry.createdAt}>{readingDate(thread.post.entry.createdAt)}</time></header>
          {thread.post.entry.body ? <><div hidden={checkingViewer}><SpoilerText key={thread.viewer.accountId ?? 'guest'} body={thread.post.entry.body} progress={thread.post.entry.progress} readerProgress={readerProgress} unread={unread} defaultHide={protect}/></div>{checkingViewer && <p className={styles.help} role="status">Checking your reading place…</p>}</> : <p className={styles.milestone}>{thread.post.entry.progress === 100 ? 'Finished this book.' : thread.post.entry.progress === 0 ? 'Started a new reading journey.' : `Reached ${thread.post.entry.progress}% of this book.`}</p>}
          <footer className={styles.entryFooter}><span><BookOpen size={14}/>{progressLabel(thread.post.entry.progress, thread.post.entry.page)}</span><span><MessageCircle size={14}/>{thread.comments.length} {thread.comments.length === 1 ? 'reply' : 'replies'}</span></footer>
        </article>
        <section className={styles.replies} aria-label="Replies">
          <h2>A little company along the way</h2>
          {!thread.comments.length && <p className={styles.emptyReplies}>Leave a thought, ask a question, or let someone know you’re reading along.</p>}
          {thread.comments.map(comment => <article id={'comment-' + comment.id} className={styles.reply} key={comment.id}>
            <header className={styles.entryHeader}><strong>{comment.profileId ? <a href={'/u/' + encodeURIComponent(comment.profileId)}>{comment.name}</a> : comment.name}</strong><time dateTime={comment.createdAt}>{readingDate(comment.createdAt)}</time></header>
            <div hidden={checkingViewer}><SpoilerText key={thread.viewer.accountId ?? 'guest'} body={comment.body} progress={comment.progress} readerProgress={readerProgress} unread={unread} defaultHide={protect}/></div>{checkingViewer && <p className={styles.help}>Checking your reading place…</p>}
            <footer className={styles.entryFooter}><span>{progressLabel(comment.progress)} marker</span>{!checkingViewer && comment.canDelete && (deleting === comment.id ? <span><button className="text-button danger-text" disabled={busy} onClick={() => void removeComment(comment)}>Remove reply</button><button className="text-button" disabled={busy} onClick={() => setDeleting(null)}>Keep it</button></span> : <button className="text-button" onClick={() => setDeleting(comment.id)} aria-label={'Remove reply by ' + comment.name}><Trash2 size={13}/>{thread.viewer.canModerate ? 'Remove' : 'Delete'}</button>)}</footer>
          </article>)}
        </section>
        {error && <p className="notice error" role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {checkingViewer && <p className={styles.help} role="status">Checking your account before replying…</p>}
        {thread.viewer.accountId ? <form hidden={checkingViewer} className={styles.replyForm} onSubmit={event => void reply(event)}>
          <h2>Meet them where they are</h2><p>Keep your reply within the entry’s {thread.post.entry.progress}% marker. If you discuss something later, raise your reply’s marker so it stays hidden from readers who haven’t reached it.</p>
          <label className="field">Your reply<textarea value={body} onChange={event => setBody(event.target.value)} maxLength={4000} rows={5} placeholder="What stayed with you at this point?" required disabled={busy}/></label>
          <div className={styles.composerFooter}><label>Discusses events up to <span><input type="number" min={thread.post.entry.progress} max="100" step="0.1" value={replyProgress} onChange={event => setReplyProgress(event.target.value)} required disabled={busy}/> %</span></label><button type="submit" className="button primary" disabled={busy || !body.trim() || thread.comments.length >= 100}>{busy ? <LoaderCircle size={15} className="spin"/> : <Send size={15}/>}Share reply</button></div>
          <p className={styles.help}>Your display name and reply will be public while this entry is shared.{thread.comments.length >= 100 ? ' This conversation has reached its limit of 100 replies.' : ''}</p>
        </form> : <div hidden={checkingViewer} className={styles.signinPrompt}><h2>A story is better with company.</h2><p>Sign in to reply at this point in the book.</p><a className="button primary" href={signInPath(returnPath)}>Join the conversation <ArrowUpRight size={15}/></a></div>}
      </> : null}
    </main>
    <footer className={styles.siteFooter}><a href="/" className={styles.brand}><BrandWordmark/></a><p>A home for your books. A little company for the journey.</p></footer>
  </div>;
}
