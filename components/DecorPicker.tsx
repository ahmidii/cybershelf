'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FlipHorizontal, Globe, Info, LoaderCircle, Plus, RefreshCw, Search, Sprout, Upload, X } from 'lucide-react';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { DECOR_CATALOGUE } from '@/lib/decor-catalogue';
import type { SharedAsset } from '@/lib/shared-assets';
import { assetUrl, type DecorKind, type ShelfItem } from '@/lib/types';
import { decorSize } from '@/lib/shelf-geometry';
import DecorArt from './DecorArt';
import CommunityAssetDetails, { AssetImage } from './CommunityAssetDetails';
import CommunityAssetContribution from './CommunityAssetContribution';
import styles from './DecorPicker.module.css';

type Collection = 'curated' | 'community' | 'mine';
const labels: Record<string, string> = { plants: 'Plants', figures: 'Figures', toys: 'Toys', objects: 'Objects', food: 'Food', seasonal: 'Seasonal', ceramics: 'Ceramics', bookends: 'Bookends' };
const originalLabels = { plant: 'Plant', bear: 'Teddy', vase: 'Vase', robot: 'Robot', bookend: 'Bookend' };

export interface DecorPickerProps {
  accountId: string | null;
  profileName: string;
  disabled?: boolean;
  uploading?: boolean;
  selectedItem?: ShelfItem;
  onAdd: (asset: SharedAsset) => void;
  onAddBuiltin: (kind: DecorKind) => void;
  onUpload: (file: File) => Promise<ShelfItem | null>;
  onUpdateItem: (id: string, changes: Partial<ShelfItem>, remember?: boolean) => void;
}

export default function DecorPicker({ accountId, profileName, disabled = false, uploading = false, selectedItem, onAdd, onAddBuiltin, onUpload, onUpdateItem }: DecorPickerProps) {
  const [collection, setCollection] = useState<Collection>('curated'), [query, setQuery] = useState(''), [category, setCategory] = useState('');
  const [assets, setAssets] = useState<SharedAsset[]>([]), [cursor, setCursor] = useState<string | undefined>(), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null), [contribution, setContribution] = useState<ShelfItem | null>(null), [lastUpload, setLastUpload] = useState<ShelfItem | null>(null), [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null), session = useRef(0), resizing = useRef(false);
  const size = selectedItem?.kind === 'decor' ? decorSize(selectedItem) : null;
  const categories = useMemo(() => [...new Set([...DECOR_CATALOGUE.map(asset => asset.category), ...assets.map(asset => asset.category), category])].filter(Boolean).sort((a, b) => (labels[a] || a).localeCompare(labels[b] || b)), [assets, category]);
  const load = useCallback(async (after?: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setError(''); setLoading(true);
    if (!after) { setAssets([]); setCursor(undefined); }
    if (collection === 'mine' && !accountId) { setLoading(false); return; }
    const parameters = new URLSearchParams({ kind: 'decor' });
    if (query.trim()) parameters.set('q', query.trim());
    if (category) parameters.set('category', category);
    if (collection === 'mine') parameters.set('mine', 'true'); else parameters.set('origin', collection);
    if (after) parameters.set('cursor', after);
    try {
      const response = await fetch('/api/community-assets?' + parameters, { cache: 'no-store', ...(accountId ? { headers: { [ACCOUNT_ID_HEADER]: accountId } } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const result = await response.json() as { assets?: SharedAsset[]; nextCursor?: string; error?: string };
      if (!response.ok || !Array.isArray(result.assets)) throw new Error(result.error || 'The decoration collection could not be loaded.');
      if (!controller.signal.aborted) { setAssets(current => after ? [...current, ...result.assets!.filter(asset => !current.some(saved => saved.id === asset.id))] : result.assets!); setCursor(result.nextCursor); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The decoration collection could not be loaded.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [accountId, collection, query, category]);
  useEffect(() => { const timer = setTimeout(() => void load(), query ? 200 : 0); return () => { clearTimeout(timer); request.current?.abort(); }; }, [load, query]);
  useEffect(() => { session.current++; setDetailId(null); setContribution(null); setLastUpload(null); setNotice(''); return () => { session.current++; request.current?.abort(); }; }, [accountId]);

  const add = (asset: SharedAsset) => { if (disabled || asset.status !== 'approved' || asset.kind !== 'decor') return; onAdd(asset); setNotice(`${asset.title} added. Drag it to its own little spot.`); };
  async function upload(file: File) {
    const started = session.current; setNotice(''); setError('');
    try {
      const item = await onUpload(file);
      if (started !== session.current) return;
      if (item) { setLastUpload(item); setNotice('Added privately to your shelf. Sharing with the community is optional.'); }
    } catch (reason) { if (started === session.current) setError(reason instanceof Error ? reason.message : 'Your image could not be uploaded.'); }
  }
  const openContribution = (item: ShelfItem) => { if (!disabled && accountId && item.assetId) { setDetailId(null); setContribution(item); } };

  return <div className={styles.picker}>
    <div className={styles.heading}><div><h3>Little things.</h3><p>Find something that feels like you.</p></div><Sprout size={22} strokeWidth={1.2} aria-hidden="true" /></div>
    <div className={styles.search}><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search shelf decorations" placeholder="Plants, toys, little treasures…" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} />{query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear decoration search"><X size={14} /></button> : null}</div>
    <div className={styles.tabs} role="group" aria-label="Decoration collection">{(['curated', 'community', 'mine'] as const).map(value => <button key={value} type="button" aria-pressed={collection === value} onClick={() => { setCollection(value); setCategory(''); setCursor(undefined); }}>{value === 'curated' ? 'Collection' : value === 'community' ? 'Community' : 'Mine'}</button>)}</div>
    <div className={styles.filters}><select aria-label="Decoration category" value={category} onChange={event => setCategory(event.target.value)}><option value="">Every little thing</option>{categories.map(value => <option key={value} value={value}>{labels[value] || value.replace(/[-_]/g, ' ')}</option>)}</select>{assets.length ? <span className={styles.resultCount}>{assets.length}{cursor ? '+' : ''} items</span> : null}</div>
    {collection === 'mine' && !accountId ? <div className={styles.empty}><Globe size={24} strokeWidth={1.2} /><h4>A little contribution.</h4><p><a href={signInPath()}>Sign in</a> to share original decorations and follow their review.</p></div> : null}
    {error ? <div className={styles.notice + ' ' + styles.error} role="alert">{error}<button type="button" className={styles.retry} onClick={() => void load()}><RefreshCw size={12} />Try again</button></div> : null}
    {assets.length ? <div className={styles.grid} aria-label="Decorations">{assets.map(asset => <article className={styles.card} key={asset.id} data-status={asset.status}>
      <button type="button" className={styles.add} disabled={disabled} onClick={() => asset.status === 'approved' ? add(asset) : setDetailId(asset.id)} aria-label={asset.status === 'approved' ? 'Add ' + asset.title + ' to shelf' : 'Review contribution: ' + asset.title}>
        <span className={styles.image}><AssetImage asset={asset} thumbnail />{asset.status === 'approved' ? <span className={styles.addIcon}><Plus size={12} /></span> : null}</span><span className={styles.title}>{asset.title}</span>
      </button>
      <div className={styles.cardBottom}><small className={asset.status === 'pending' ? styles.statusLabel : undefined}>{asset.status === 'pending' ? 'Awaiting review' : asset.status === 'rejected' ? 'Not approved' : asset.status === 'withdrawn' ? 'Withdrawn' : asset.creator}</small><button type="button" className={styles.info} aria-label={'Details and credits for ' + asset.title} onClick={() => setDetailId(asset.id)}><Info size={13} /></button></div>
    </article>)}</div> : null}
    {loading ? <div className={styles.loading} role="status"><LoaderCircle size={16} className="spin" />Finding little things…</div> : !error && !assets.length && (collection !== 'mine' || accountId) ? <div className={styles.empty}><Sprout size={25} strokeWidth={1.2} /><h4>{query || category ? 'A little more exploring.' : collection === 'community' ? 'Room to grow.' : collection === 'mine' ? 'Something only you could add.' : 'The collection is on its way.'}</h4><p>{query || category ? 'Try another search, or choose a different category.' : collection === 'community' ? 'Reader-contributed decorations appear here after review. You can be the first to share one.' : collection === 'mine' ? 'Upload a decoration below, then choose to share a community copy.' : 'Refresh the collection in a moment.'}</p></div> : null}
    {cursor && !loading ? <button type="button" className="button secondary small full" onClick={() => void load(cursor)}>A few more things</button> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {selectedItem?.kind === 'decor' && size ? <section className={styles.selectedTools} aria-label="Selected decoration settings">
      <h4>{selectedItem.label || 'Your decoration'}</h4>
      <label><span>Size <small>{(size.height / 10).toFixed(1)} cm tall</small></span><input type="range" min={30} max={240} step={5} aria-label="Decoration height" aria-valuetext={(size.height / 10).toFixed(1)+' centimeters tall'} onPointerDown={()=>{resizing.current=false;}} onPointerUp={()=>{resizing.current=false;}} onKeyDown={event=>{if(!event.repeat)resizing.current=false;}} onKeyUp={()=>{resizing.current=false;}} onBlur={()=>{resizing.current=false;}} value={Math.round(size.height)} disabled={disabled} onChange={event => { const requested = Number(event.target.value), ratio = size.width / size.height; const height = Math.min(requested, 350 / Math.max(.02, ratio)); onUpdateItem(selectedItem.id, { decorHeightMm: Math.max(10, height), decorWidthMm: Math.max(5, Math.min(350, height * ratio)) }, !resizing.current); resizing.current=true; }} /></label>
      <div className={styles.selectedActions}><button type="button" className="button secondary small" aria-pressed={!!selectedItem.decorFlip} disabled={disabled} onClick={() => onUpdateItem(selectedItem.id, { decorFlip: !selectedItem.decorFlip })}><FlipHorizontal size={13} />Flip</button>{selectedItem.sharedAssetId ? <button type="button" className="text-button" onClick={() => setDetailId(selectedItem.sharedAssetId!)}><Info size={12} />Credits &amp; details</button> : selectedItem.assetId && accountId ? <button type="button" className="text-button" disabled={disabled} onClick={() => openContribution(selectedItem)}><Globe size={12} />Share with readers</button> : null}</div>
    </section> : null}
    <div className={styles.own}>
      {accountId ? <label className={'button secondary full ' + (disabled || uploading ? 'disabled' : '')}>{uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{uploading ? 'Saving your decoration…' : 'Bring your own'}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a personal decoration" disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label> : <a className="button secondary full" href={signInPath()}><Upload size={15} />Sign in to bring your own</a>}
      <p>PNG, JPEG, or WebP · up to 4 MB<br />A transparent background sits naturally on the shelf.</p><a className="text-button" href="/community-contributions#my-contributions">My contributions &amp; sharing permissions</a>
      {lastUpload?.assetId && accountId ? <div className={styles.photoAdded}><img src={assetUrl(lastUpload.assetId)} alt="Your uploaded decoration" /><div><strong><Check size={11} /> Added to your shelf</strong><button type="button" disabled={disabled} onClick={() => openContribution(lastUpload)}>Share a copy with the community</button></div></div> : null}
    </div>
    <details className={styles.originals}><summary>The original little things</summary><div className={styles.originalGrid}>{(['plant', 'bear', 'vase', 'robot', 'bookend'] as const).map(kind => <button type="button" key={kind} disabled={disabled} onClick={() => onAddBuiltin(kind)}><DecorArt kind={kind} /><span>{originalLabels[kind]}</span></button>)}</div></details>
    {detailId ? <CommunityAssetDetails assetId={detailId} accountId={accountId} onClose={() => { setDetailId(null); if (collection === 'mine') void load(); }} onUse={disabled ? undefined : asset => { add(asset); setDetailId(null); }} /> : null}
    {contribution?.assetId && accountId ? <CommunityAssetContribution key={contribution.assetId + ':' + accountId} accountId={accountId} assetId={contribution.assetId} kind="decor" initialTitle={contribution.label || 'My decoration'} initialCreator={profileName} initialWidthMm={decorSize(contribution).width} initialHeightMm={decorSize(contribution).height} onClose={() => setContribution(null)} onSubmitted={() => { setContribution(null); setLastUpload(null); setCollection('mine'); setCategory(''); setQuery(''); setNotice('Contribution saved for review. Your personal decoration stays on your shelf.'); if (collection === 'mine') void load(); }} /> : null}
  </div>;
}
