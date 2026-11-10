'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import type { SharedAsset, SharedAssetStatus } from '@/lib/shared-assets';
import { AssetCredits, AssetImage } from './CommunityAssetDetails';
import styles from './CommunityAssets.module.css';

export default function CommunityAssetModeration({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<SharedAssetStatus>('pending'), [assets, setAssets] = useState<SharedAsset[]>([]), [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reauth, setReauth] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (after?: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); if (!after) { setAssets([]); setCursor(undefined); }
    try {
      const response = await fetch('/api/community-assets/moderation?status=' + status + (after ? '&cursor=' + encodeURIComponent(after) : ''), { cache: 'no-store', headers: { [ACCOUNT_ID_HEADER]: accountId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const result = await response.json() as { assets?: SharedAsset[]; nextCursor?: string; error?: string };
      if (!response.ok || !result.assets) throw new Error(result.error || 'The catalogue review queue is unavailable.');
      if (!controller.signal.aborted) { setAssets(current => after ? [...current, ...result.assets!] : result.assets!); setCursor(result.nextCursor); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The catalogue review queue is unavailable.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [accountId, status]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);
  return <section className={styles.reviewSection} aria-label="Community catalogue review">
    <div className={styles.reviewHeading}><div><h2>A growing shared collection.</h2><p>Check each image, its source or permission, and the edition for book artwork. Approval makes it available to other readers.</p></div><button type="button" className="button quiet small" disabled={loading} onClick={() => void load()}><RefreshCw size={13} />Refresh</button></div>
    <div className={styles.reviewTabs} role="group" aria-label="Contribution review status">{(['pending', 'approved', 'rejected', 'withdrawn'] as const).map(value => <button type="button" className="button secondary small" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{value === 'pending' ? 'Awaiting review' : value === 'approved' ? 'Approved' : value === 'rejected' ? 'Not approved' : 'Withdrawn'}</button>)}</div>
    {reauth ? <p className={styles.notice}><a href={signInPath('/moderation') + '&reauth=1'}>Sign in again to take moderation actions</a></p> : null}
    {error ? <p className={styles.notice + ' ' + styles.error} role="alert">{error}</p> : null}
    <div className={styles.reviewList}>{assets.map(asset => <ContributionCard key={asset.id} asset={asset} accountId={accountId} onDone={() => void load()} onReauth={() => setReauth(true)} />)}</div>
    {loading ? <div className={styles.loading} role="status"><LoaderCircle size={17} className="spin" />Loading catalogue contributions…</div> : !assets.length && !error ? <p className={styles.notice}>No contributions in this view.</p> : null}
    {cursor && !loading ? <button type="button" className="button secondary" onClick={() => void load(cursor)}>More contributions</button> : null}
  </section>;
}

function ContributionCard({ asset, accountId, onDone, onReauth }: { asset: SharedAsset; accountId: string; onDone: () => void; onReauth: () => void }) {
  const [action, setAction] = useState<'approve' | 'reject' | 'withdraw'>(asset.status === 'approved' ? 'withdraw' : 'approve');
  const [note, setNote] = useState(''), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function decide() {
    if (busy || note.trim().length < 3) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch('/api/community-assets/' + encodeURIComponent(asset.id) + '/review', { method: 'POST', headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: accountId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), body: JSON.stringify({ action, note: note.trim() }) });
      const result = await response.json() as { error?: string; code?: string };
      if (!response.ok) { if (result.code === 'FRESH_SESSION_REQUIRED') onReauth(); throw new Error(result.error || 'This review could not be saved.'); }
      if (!controller.signal.aborted) { window.dispatchEvent(new CustomEvent('cybershelf:community-artwork')); setConfirm(false); onDone(); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This review could not be saved.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <article className={styles.reviewCard}>
    <div className={styles.reviewImage}><AssetImage asset={asset} /></div>
    <div className={styles.reviewContent}><span className={styles.status} data-status={asset.status}>{asset.kind} · {asset.status}</span><h3>{asset.title}</h3>
      {asset.description ? <p>{asset.description}</p> : null}<AssetCredits asset={asset} />
      <dl className={styles.meta}><dt>Submitted</dt><dd><time dateTime={asset.createdAt}>{new Date(asset.createdAt).toLocaleString()}</time></dd>{asset.edition?.isbn ? <><dt>ISBN</dt><dd>{asset.edition.isbn}</dd></> : null}{asset.edition?.editionId ? <><dt>Edition</dt><dd>{asset.edition.editionId}</dd></> : null}{asset.edition?.variant ? <><dt>Variant</dt><dd>{asset.edition.variant}</dd></> : null}{asset.category ? <><dt>Category</dt><dd>{asset.category}</dd></> : null}</dl>
      {asset.tags.length ? <div className={styles.tags}>{asset.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</div> : null}
      {asset.reviewNote ? <p className={styles.notice}>Last review: {asset.reviewNote}</p> : null}
      {asset.status === 'pending' || asset.status === 'approved' ? <form className={styles.form} onSubmit={event => { event.preventDefault(); setConfirm(true); }}>
        <label className={styles.field}>Decision<select value={action} onChange={event => { setAction(event.target.value as typeof action); setConfirm(false); }} disabled={busy}>{asset.status === 'pending' ? <><option value="approve">Approve for the shared catalogue</option><option value="reject">Do not approve</option></> : <option value="withdraw">Withdraw from the shared catalogue</option>}</select></label>
        <label className={styles.field}>Review note<textarea rows={3} minLength={3} maxLength={1000} required value={note} onChange={event => { setNote(event.target.value); setConfirm(false); }} disabled={busy} placeholder="Record the source/permission and edition checks, or explain what needs to change." /><small>This note is saved with the decision and can be shown to the contributor.</small></label>
        {confirm ? <><p className={styles.reviewNotice}>{action === 'approve' ? 'Make this contribution available to everyone?' : action === 'reject' ? 'Reject this contribution and remove its shared image?' : 'Remove this shared image from the catalogue and shelves using it?'}</p><div className={styles.actions}><button type="button" className={'button ' + (action === 'approve' ? 'primary' : 'danger')} disabled={busy} onClick={() => void decide()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{busy ? 'Saving…' : 'Confirm decision'}</button><button type="button" className="button quiet" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div></> : <button className="button secondary" disabled={busy || note.trim().length < 3}>Review decision</button>}
      </form> : <p className={styles.reviewNotice}>The shared image has been removed. A corrected contribution can be submitted as a new item.</p>}
      {error ? <p className={styles.notice + ' ' + styles.error} role="alert">{error}</p> : null}
    </div>
  </article>;
}
