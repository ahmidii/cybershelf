'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Globe, ImagePlus, Info, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Asset, Book } from '@/lib/types';
import { assetUrl } from '@/lib/types';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import { hasArtworkEdition, selectCommunityArtwork } from '@/lib/community-artwork';
import { canonicalISBN, spineCopyIdentity } from '@/lib/spine-image';
import { sharedAssetMatchesEdition, type SharedAsset, type SharedAssetKind, type SharedAssetMatch } from '@/lib/shared-assets';
import CommunityAssetContribution from './CommunityAssetContribution';
import CommunityAssetDetails, { AssetImage } from './CommunityAssetDetails';
import styles from './EditionArtwork.module.css';

type ArtworkKind = Extract<SharedAssetKind, 'spine' | 'cover'>;

export default function EditionArtwork({ book, onChange, accountId }: { book: Book; onChange: (book: Book) => void; accountId: string | null }) {
  const [kind, setKind] = useState<ArtworkKind>('spine');
  const [assets, setAssets] = useState<SharedAsset[]>([]), [mine, setMine] = useState<SharedAsset[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0), [contributing, setContributing] = useState<{ assetId: string; kind: ArtworkKind; copy: string; accountId: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null), [uploading, setUploading] = useState(false);
  const current = useRef({ book, accountId, onChange }); current.current = { book, accountId, onChange };
  const live = useRef(true), upload = useRef<AbortController | null>(null);
  const identity = spineCopyIdentity(book), eligible = hasArtworkEdition(book);
  const privateId = (kind === 'spine' ? book.spineUrl : book.coverUrl)?.match(/^\/api\/assets\/([A-Za-z0-9_-]{1,100})$/)?.[1];
  const selectedId = kind === 'spine' ? book.spineAssetId : book.coverAssetId;

  useEffect(() => { live.current = true; return () => { live.current = false; upload.current?.abort(); }; }, []);
  useEffect(() => { setContributing(null); setDetail(null); setNotice(''); upload.current?.abort(); setUploading(false); }, [identity, accountId]);
  useEffect(() => {
    if (!eligible) { setAssets([]); setMine([]); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    const refresh = async () => {
      try {
        const response = await fetch('/api/community-assets/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(accountId ? { [ACCOUNT_ID_HEADER]: accountId } : {}) },
          body: JSON.stringify({ books: [{ id: book.id, catalogId: book.catalogId, editionId: book.editionId, isbn: book.isbn }] }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store',
        });
        const result = await response.json() as { matches?: SharedAssetMatch[]; truncated?: boolean; error?: string };
        if (!response.ok) throw new Error(result.error || 'Community artwork could not be loaded. Your current images are kept.');
        if (result.truncated) throw new Error('This edition has too many artwork submissions to choose automatically. Your current image is kept.');
        if (!controller.signal.aborted) setAssets(result.matches?.find(match => match.bookId === book.id)?.alternatives ?? []);
        if (accountId) {
          const own = await fetch('/api/community-assets?mine=true&kind=' + kind, { headers: { [ACCOUNT_ID_HEADER]: accountId }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
          if (own.ok) {
            const data = await own.json() as { assets: SharedAsset[] };
            if (!controller.signal.aborted) setMine(data.assets.filter(asset => sharedAssetMatchesEdition(asset, book)));
          }
        } else if (!controller.signal.aborted) setMine([]);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Community artwork could not be loaded.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh();
    return () => controller.abort();
  }, [identity, accountId, eligible, kind, version]);
  useEffect(() => {
    const refresh = () => setVersion(value => value + 1);
    window.addEventListener('cybershelf:community-artwork', refresh);
    return () => window.removeEventListener('cybershelf:community-artwork', refresh);
  }, []);

  const useArtwork = (asset: SharedAsset) => {
    if (spineCopyIdentity(current.current.book) !== identity || current.current.accountId !== accountId) return;
    const next = selectCommunityArtwork(current.current.book, asset);
    if (next === current.current.book) { setError('This artwork does not match the selected edition.'); return; }
    current.current.onChange(next); setDetail(null); setNotice(`Community ${asset.kind} selected. You can choose another variant any time.`);
  };
  const uploadCover = async (file: File | undefined) => {
    if (!file || !accountId || uploading) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 4 * 1024 * 1024) { setError('Choose a PNG, JPEG, or WebP cover up to 4 MB.'); return; }
    const selectedCopy = identity, selectedAccount = accountId, controller = new AbortController(); upload.current = controller;
    setUploading(true); setError(''); setNotice('');
    try {
      const body = new FormData(); body.append('file', file); body.append('kind', 'image');
      const response = await fetch('/api/assets', { method: 'POST', headers: { [ACCOUNT_ID_HEADER]: accountId }, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json() as Asset & { error?: string };
      if (!response.ok) throw new Error(data.error || 'This cover could not be saved.');
      if (controller.signal.aborted || !live.current || current.current.accountId !== selectedAccount || spineCopyIdentity(current.current.book) !== selectedCopy) return;
      current.current.onChange({ ...current.current.book, coverUrl: assetUrl(data.id), coverAssetId: undefined });
      setNotice('Cover saved to your copy. Choose “Contribute this cover” if you would like other readers to use it.');
    } catch (reason) { if (!controller.signal.aborted && live.current) setError(reason instanceof Error ? reason.message : 'This cover could not be saved.'); }
    finally { if (!controller.signal.aborted && live.current) setUploading(false); }
  };
  const choices = assets.filter(asset => asset.kind === kind);
  const contributions = mine.filter(asset => asset.kind === kind);

  return <section className={styles.panel} aria-label="Community edition artwork">
    <div className={styles.heading}><div><span className={styles.eyebrow}>A CATALOGUE WE BUILD TOGETHER</span><h4>Artwork for your edition</h4></div><Globe size={20} strokeWidth={1.4} /></div>
    <p className={styles.intro}>Choose a matching spine or cover, or contribute a photo so the next reader can find it here.</p>
    <div className={styles.tabs} role="tablist" aria-label="Artwork type">{(['spine', 'cover'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => { setKind(value); setNotice(''); }}>{value === 'spine' ? 'Spines' : 'Covers'}<span>{assets.filter(asset => asset.kind === value).length}</span></button>)}</div>
    {!eligible ? <p className={styles.empty}>Add this copy’s ISBN above or choose its edition on the book page. Matching artwork belongs to an edition, so different printings can keep their own appearance.</p> : <>
      {loading ? <p className={styles.loading} role="status"><LoaderCircle size={15} className="spin" />Finding matching artwork…</p> : choices.length ? <div className={styles.grid}>{choices.map(asset => <article key={asset.id} className={styles.card} data-selected={selectedId === asset.id}>
        <button className={styles.choice} type="button" onClick={() => useArtwork(asset)} aria-pressed={selectedId === asset.id} aria-label={`Use ${asset.title}${asset.edition?.variant ? ', ' + asset.edition.variant : ''}`}><div className={styles.image} data-kind={kind}><AssetImage asset={asset} /></div><strong>{asset.edition?.variant || asset.title}</strong><span>{selectedId === asset.id ? <><Check size={12} />On your copy</> : `Use this ${kind}`}</span></button>
        <button className={styles.credit} type="button" onClick={() => setDetail(asset.id)}><Info size={12} />By {asset.creator}</button>
      </article>)}</div> : <p className={styles.empty}>No approved {kind === 'spine' ? 'spines' : 'covers'} for this edition yet. Your photo could be the first.</p>}
      {choices.length > 1 ? <p className={styles.hint}>This edition has more than one artwork variant. Choose the one that matches your copy.</p> : null}
      <div className={styles.actions}>
        {accountId && privateId ? <button type="button" className="button secondary small" onClick={() => setContributing({ assetId: privateId, kind, copy: identity, accountId })}><Globe size={14} />Contribute this {kind}</button> : null}
        {kind === 'cover' && accountId ? <label className={'button secondary small ' + (uploading ? 'disabled' : '')}>{uploading ? <LoaderCircle size={14} className="spin" /> : <ImagePlus size={14} />}Upload your cover<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => { void uploadCover(event.target.files?.[0]); event.target.value = ''; }} /></label> : null}
        <button type="button" className="button quiet small" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw size={13} />Refresh</button>
      </div>
      {kind === 'spine' && !privateId ? <p className={styles.hint}>Use “Choose photo” or “Take photo” above to add your own spine. Uploading it stays personal until you choose to contribute.</p> : null}
      {contributions.length ? <details className={styles.contributions}><summary>Your contributions to this edition <span>{contributions.length}</span></summary><div>{contributions.map(asset => <button type="button" key={asset.id} onClick={() => setDetail(asset.id)}><span>{asset.edition?.variant || asset.title}</span><small>{asset.status === 'pending' ? 'Awaiting review' : asset.status}</small><Info size={13} /></button>)}</div></details> : null}
    </>}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}{error ? <p className="notice error" role="alert">{error}</p> : null}
    {contributing && accountId === contributing.accountId && identity === contributing.copy ? <CommunityAssetContribution accountId={accountId} assetId={contributing.assetId} kind={contributing.kind} initialTitle={`${book.title} — ${contributing.kind}`} initialCreator="" edition={{ catalogId: book.catalogId, editionId: book.editionId, isbn: canonicalISBN(book.isbn) }} onClose={() => setContributing(null)} onSubmitted={asset => { setContributing(null); setMine(previous => [asset, ...previous.filter(item => item.id !== asset.id)]); setNotice('Contribution saved. Other readers can use it once it has been reviewed. Your personal image stays on your copy.'); }} /> : null}
    {detail ? <CommunityAssetDetails assetId={detail} accountId={accountId} onClose={() => { setDetail(null); setVersion(value => value + 1); }} onUse={useArtwork} /> : null}
  </section>;
}
