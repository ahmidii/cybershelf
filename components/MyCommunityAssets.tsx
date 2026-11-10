'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import type { SharedAsset } from '@/lib/shared-assets';
import CommunityAssetDetails, { AssetImage } from './CommunityAssetDetails';
import styles from './EditionArtwork.module.css';

export default function MyCommunityAssets({ accountId }: { accountId: string }) {
  const [assets, setAssets] = useState<SharedAsset[]>([]), [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void fetch('/api/community-assets?mine=true&kind=all', { cache: 'no-store', headers: { [ACCOUNT_ID_HEADER]: accountId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(async response => {
      const data = await response.json() as { assets: SharedAsset[]; nextCursor?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Your contributions could not be loaded.');
      if (!controller.signal.aborted) { setAssets(data.assets); setCursor(data.nextCursor); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Your contributions could not be loaded.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, version]);
  async function more() {
    if (!cursor || loading) return;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/community-assets?mine=true&kind=all&cursor=' + encodeURIComponent(cursor), { cache: 'no-store', headers: { [ACCOUNT_ID_HEADER]: accountId }, signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { assets: SharedAsset[]; nextCursor?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'More contributions could not be loaded.');
      setAssets(previous => [...previous, ...data.assets.filter(asset => !previous.some(item => item.id === asset.id))]); setCursor(data.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More contributions could not be loaded.'); }
    finally { setLoading(false); }
  }
  return <div>
    {assets.length ? <div className={styles.grid}>{assets.map(asset => <article key={asset.id} className={styles.card}><button type="button" className={styles.choice} onClick={() => setSelected(asset.id)}><div className={styles.image} data-kind={asset.kind}><AssetImage asset={asset} /></div><strong>{asset.title}</strong><span>{asset.kind} · {asset.status === 'pending' ? 'Awaiting review' : asset.status}</span><span>Details &amp; withdrawal <ArrowUpRight size={12} /></span></button></article>)}</div> : !loading && !error ? <p>You haven’t contributed artwork yet. Add a spine in Book details or a decoration while arranging a shelf, then choose to share a community copy.</p> : null}
    {loading ? <p className={styles.loading} role="status"><LoaderCircle size={15} className="spin" />Opening your contributions…</p> : null}
    {cursor ? <button type="button" className="button secondary small" disabled={loading} onClick={() => void more()}>Show more contributions</button> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {selected ? <CommunityAssetDetails assetId={selected} accountId={accountId} onClose={() => { setSelected(null); setVersion(value => value + 1); }} /> : null}
  </div>;
}
