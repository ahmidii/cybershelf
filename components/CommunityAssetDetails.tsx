'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Flag, ImageOff, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import type { SharedAsset, SharedAssetKind } from '@/lib/shared-assets';
import { Modal } from './Dialogs';
import styles from './CommunityAssets.module.css';

export function publicAssetLink(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function AssetCredits({ asset }: { asset: SharedAsset }) {
  const source = publicAssetLink(asset.sourceUrl), license = publicAssetLink(asset.licenseUrl);
  const label = asset.license === 'community-permission' ? 'Community reuse permission' : asset.license;
  return <div className={styles.credit}><span>By {asset.creator}</span>{source ? <a href={source} target="_blank" rel="noreferrer">Original source <ArrowUpRight size={10} /></a> : null}{license ? <a href={license} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>}</div>;
}

export function AssetImage({ asset, className, thumbnail = false }: { asset: SharedAsset; className?: string; thumbnail?: boolean }) {
  const src = thumbnail ? asset.thumbnailUrl || asset.imageUrl : asset.imageUrl;
  const [failedUrl, setFailedUrl] = useState('');
  return asset.status === 'withdrawn' || asset.status === 'rejected' || failedUrl === src ? <span className={styles.pictureError}><ImageOff size={25} strokeWidth={1.2} />Artwork unavailable</span>
    : <img src={src} alt={asset.title} className={className} draggable={false} loading="lazy" decoding="async" onError={() => setFailedUrl(src)} />;
}

export default function CommunityAssetDetails({ assetId, accountId = null, onClose, onUse, useKinds }: { assetId: string; accountId?: string | null; onClose: () => void; onUse?: (asset: SharedAsset) => void; useKinds?: SharedAssetKind[] }) {
  const [asset, setAsset] = useState<SharedAsset | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [reporting, setReporting] = useState(false), [reason, setReason] = useState('other'), [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setAsset(null); setLoading(true); setError(''); setNotice(''); setReporting(false); setWithdrawConfirm(false);
    void (async () => {
      try {
        const response = await fetch('/api/community-assets/' + encodeURIComponent(assetId), { cache: 'no-store', ...(accountId ? { headers: { [ACCOUNT_ID_HEADER]: accountId } } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json() as { asset?: SharedAsset; error?: string };
        if (!response.ok || !data.asset) throw new Error(data.error || 'This contribution is no longer available.');
        if (!controller.signal.aborted) setAsset(data.asset);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This contribution could not be opened.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [assetId, accountId]);
  useEffect(() => () => request.current?.abort(), []);

  async function report() {
    if (!accountId || !asset || busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: accountId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), body: JSON.stringify({ kind: 'asset', targetId: asset.id, reason, details: details.trim() }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Your report could not be saved.');
      if (!controller.signal.aborted) { setReporting(false); setDetails(''); setNotice('Report received. A moderator can review the artwork and its edition or permissions.'); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Your report could not be saved.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function withdraw() {
    if (!accountId || !asset || busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/community-assets/' + encodeURIComponent(asset.id), { method: 'DELETE', headers: { [ACCOUNT_ID_HEADER]: accountId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'This contribution could not be withdrawn.');
      if (!controller.signal.aborted) { window.dispatchEvent(new CustomEvent('cybershelf:community-artwork')); setAsset({ ...asset, status: 'withdrawn', canWithdraw: false }); setWithdrawConfirm(false); setNotice('Contribution withdrawn. Its shared image is no longer available. Your personal upload is unchanged.'); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This contribution could not be withdrawn.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <Modal title={asset?.title ?? 'From the shared catalogue.'} subtitle={asset?.origin === 'curated' ? 'Selected for the little worlds on your shelves.' : 'A contribution from the Cybershelf community.'} onClose={onClose}>
    <div className={styles.body}>
      {loading ? <div className={styles.loading} role="status"><LoaderCircle size={18} className="spin" />Opening this item…</div> : null}
      {asset ? <>
        <div className={styles.preview} data-kind={asset.kind}><AssetImage asset={asset} /></div>
        <span className={styles.status} data-status={asset.status}>{asset.origin === 'curated' ? 'Curated collection' : asset.status === 'pending' ? 'Awaiting review' : asset.status}</span>
        {asset.description ? <p>{asset.description}</p> : null}
        <AssetCredits asset={asset} />
        {asset.tags.length ? <div className={styles.tags}>{asset.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</div> : null}
        {asset.edition ? <dl className={styles.meta}>{asset.edition.isbn ? <><dt>ISBN</dt><dd>{asset.edition.isbn}</dd></> : null}{asset.edition.editionId ? <><dt>Edition</dt><dd>{asset.edition.editionId}</dd></> : null}{asset.edition.variant ? <><dt>Artwork variant</dt><dd>{asset.edition.variant}</dd></> : null}</dl> : null}
        {asset.status === 'pending' ? <p className={styles.notice}>This is visible to you and catalogue moderators. It becomes available to other readers after approval.</p> : null}
        {asset.reviewNote ? <p className={styles.notice}>Review note: {asset.reviewNote}</p> : null}
        {asset.status === 'approved' && ((onUse && (!useKinds || useKinds.includes(asset.kind))) || asset.kind === 'decor') ? <div className={styles.actions}>{onUse && (!useKinds || useKinds.includes(asset.kind)) ? <button type="button" className="button primary" onClick={() => onUse(asset)}><Plus size={16} />{asset.kind === 'decor' ? 'Add to my shelf' : `Use this ${asset.kind}`}</button> : <a className="button primary" href={'/?decor=' + encodeURIComponent(asset.id)}><Plus size={16} />Add to my decor</a>}</div> : null}
        {asset.origin === 'community' && asset.status === 'approved' && !asset.canWithdraw ? <div className={styles.details}>
          <button type="button" className="text-button" onClick={() => setReporting(value => !value)} disabled={busy}><Flag size={13} />Report artwork or edition</button>
          {reporting ? accountId ? <form className={styles.reportForm} onSubmit={event => { event.preventDefault(); void report(); }}>
            <label className={styles.field}>What needs attention?<select value={reason} onChange={event => setReason(event.target.value)} disabled={busy}><option value="other">Wrong edition, inaccurate artwork, or another concern</option><option value="copyright">Copyright or permission concern</option><option value="privacy">Personal information or privacy</option><option value="spam">Spam or misleading content</option><option value="sexual">Inappropriate sexual content</option><option value="hate">Hateful content</option></select></label>
            <label className={styles.field}>Details <small>Optional · help moderators identify the problem</small><textarea rows={3} maxLength={2000} value={details} onChange={event => setDetails(event.target.value)} disabled={busy} /></label>
            <div className={styles.actions}><button className="button secondary" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button><button type="button" className="button quiet" onClick={() => setReporting(false)} disabled={busy}>Cancel</button></div>
          </form> : <p className={styles.notice}><a className={styles.inline} href={signInPath('/?decor=' + encodeURIComponent(asset.id))}>Sign in to send a report</a></p> : null}
        </div> : null}
        {asset.canWithdraw && accountId ? <div className={styles.withdraw}>{withdrawConfirm ? <><p>Withdraw this contribution from the shared catalogue? Shelves using the shared image will lose access to it. Copies others already saved cannot be recalled.</p><div className={styles.actions}><button type="button" className="button danger" onClick={() => void withdraw()} disabled={busy}>{busy ? 'Withdrawing…' : 'Withdraw contribution'}</button><button type="button" className="button quiet" onClick={() => setWithdrawConfirm(false)} disabled={busy}>Keep contribution</button></div></> : <button type="button" className="text-button danger-text" onClick={() => setWithdrawConfirm(true)}><Trash2 size={13} />Withdraw my contribution</button>}</div> : null}
      </> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.notice + ' ' + styles.error} role="alert">{error}</p> : null}
    </div>
  </Modal>;
}
