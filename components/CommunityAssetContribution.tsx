'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, LoaderCircle } from 'lucide-react';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import { SHARED_ASSET_CONSENT, SHARED_ASSET_CONSENT_TEXT, type SharedAsset, type SharedAssetEdition, type SharedAssetKind } from '@/lib/shared-assets';
import { Modal } from './Dialogs';
import styles from './CommunityAssets.module.css';

export interface CommunityAssetContributionProps {
  accountId: string;
  assetId: string;
  kind: SharedAssetKind;
  initialTitle: string;
  initialCreator: string;
  initialWidthMm?: number;
  initialHeightMm?: number;
  edition?: SharedAssetEdition;
  onSubmitted: (asset: SharedAsset) => void;
  onClose: () => void;
}

export default function CommunityAssetContribution({ accountId, assetId, kind, initialTitle, initialCreator, initialWidthMm, initialHeightMm, edition, onSubmitted, onClose }: CommunityAssetContributionProps) {
  const [title, setTitle] = useState(initialTitle.slice(0, 150));
  const [creator, setCreator] = useState(initialCreator.slice(0, 100));
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState('objects');
  const [style, setStyle] = useState('photographic');
  const [sourceUrl, setSourceUrl] = useState('');
  const [license, setLicense] = useState('community-permission');
  const [variant, setVariant] = useState((edition?.variant ?? '').slice(0, 120));
  const [rights, setRights] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; request.current?.abort(); }; }, [accountId, assetId]);

  async function submit() {
    if (busy || !rights || !consent || !title.trim() || !creator.trim()) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/community-assets', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: accountId },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        body: JSON.stringify({
          assetId, kind, title: title.trim(), creator: creator.trim(), description: description.trim(),
          tags: [...new Set(tags.split(',').map(tag => tag.trim().toLocaleLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 12),
          ...(kind === 'decor' ? { category, style, license, ...(initialWidthMm ? { defaultWidthMm: initialWidthMm } : {}), ...(initialHeightMm ? { defaultHeightMm: initialHeightMm } : {}) } : { license: 'community-permission', edition: { ...(edition?.catalogId ? { catalogId: edition.catalogId } : {}), ...(edition?.editionId ? { editionId: edition.editionId } : {}), ...(edition?.isbn ? { isbn: edition.isbn } : {}), ...(variant.trim() ? { variant: variant.trim() } : {}) } }),
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), consent: SHARED_ASSET_CONSENT, rightsConfirmed: true,
        }),
      });
      const result = await response.json() as { asset?: SharedAsset; error?: string };
      if (!response.ok || !result.asset) throw new Error(result.error || 'Your contribution could not be saved. Please try again.');
      if (!controller.signal.aborted && live.current) onSubmitted(result.asset);
    } catch (reason) {
      if (!controller.signal.aborted && live.current) setError(reason instanceof Error ? reason.message : 'Your contribution could not be saved.');
    } finally { if (!controller.signal.aborted && live.current) setBusy(false); }
  }

  return <Modal title={kind === 'decor' ? 'A little something to share.' : `Share this ${kind} with other readers.`} subtitle="One contribution can make many shelves feel more complete." onClose={onClose}>
    <div className={styles.body}>
      <div className={styles.preview} data-kind={kind}><img src={'/api/assets/' + encodeURIComponent(assetId)} alt={`Your ${kind === 'decor' ? 'decoration' : kind} contribution`} /></div>
      <p>Your personal upload stays available to you. This creates a separate contribution for the shared catalogue, reviewed before other readers can use it.</p>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className={styles.fields}>
          <label className={styles.field + ' ' + styles.wide}>Name<input value={title} onChange={event => setTitle(event.target.value)} minLength={1} maxLength={150} required disabled={busy} /></label>
          <label className={styles.field + ' ' + styles.wide}>Public creator credit<input value={creator} onChange={event => setCreator(event.target.value)} minLength={1} maxLength={100} required disabled={busy} /><small>Use an artist name or a pseudonym. This credit is visible with the contribution.</small></label>
          {kind === 'decor' ? <>
            <label className={styles.field}>Category<select value={category} onChange={event => setCategory(event.target.value)} disabled={busy}><option value="objects">Objects</option><option value="plants">Plants</option><option value="figures">Figures</option><option value="toys">Toys</option><option value="ceramics">Ceramics</option><option value="bookends">Bookends</option><option value="seasonal">Seasonal</option><option value="food">Food</option></select></label>
            <label className={styles.field}>Style<select value={style} onChange={event => setStyle(event.target.value)} disabled={busy}><option value="photographic">Photographic</option><option value="illustrated">Illustrated</option><option value="low-poly">Low poly</option><option value="pixel">Pixel art</option></select></label>
          </> : <>
            <div className={styles.notice + ' ' + styles.wide}>For this edition{edition?.isbn ? <><br />ISBN {edition.isbn}</> : null}{edition?.editionId ? <><br />Edition {edition.editionId}</> : null}</div>
            <label className={styles.field + ' ' + styles.wide}>Cover or printing variant <small>Optional</small><input value={variant} onChange={event => setVariant(event.target.value)} maxLength={120} placeholder="e.g. blue cover, 2023 printing" disabled={busy} /></label>
          </>}
          <label className={styles.field + ' ' + styles.wide}>Description <small>Optional</small><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} rows={2} disabled={busy} placeholder={kind === 'decor' ? 'A few words about this little object…' : 'Anything that helps identify this artwork or edition…'} /></label>
          {kind === 'decor' ? <label className={styles.field + ' ' + styles.wide}>Search words <small>Optional · separated by commas</small><input value={tags} onChange={event => setTags(event.target.value)} maxLength={300} placeholder="plant, green, succulent" disabled={busy} /></label> : null}
          <label className={styles.field + ' ' + styles.wide}>Original source link <small>Optional · a public page, not a private file link</small><input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} maxLength={2048} placeholder="https://…" disabled={busy} /></label>
          {kind === 'decor' ? <label className={styles.field + ' ' + styles.wide}>Reuse permission<select value={license} onChange={event => setLicense(event.target.value)} disabled={busy}><option value="community-permission">Use in the Cybershelf community</option><option value="CC-BY-4.0">CC BY 4.0 — reuse with creator credit</option><option value="CC0-1.0">CC0 — dedicate my original work to the public domain</option></select><small>{license === 'community-permission' ? 'Allow readers to use and display this decoration on Cybershelf shelves.' : 'Choose this only for work you can license. Creative Commons permissions already granted cannot be recalled by withdrawing the item from Cybershelf.'}</small></label> : <p className={styles.fine + ' ' + styles.wide}>Book artwork is shared for use in Cybershelf. It is not labelled as public domain, and the publisher or artist retains their rights.</p>}
        </div>
        <label className={styles.checkbox}><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} disabled={busy} required /><span>I have the rights or permission needed to contribute this image and the information above is accurate.</span></label>
        <label className={styles.checkbox}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} required /><span><strong>Share a reusable community copy.</strong> {SHARED_ASSET_CONSENT_TEXT}</span></label>
        {error ? <p className={styles.notice + ' ' + styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}><button className="button primary" disabled={busy || !rights || !consent || !title.trim() || !creator.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Globe size={15} />}{busy ? 'Saving contribution…' : 'Submit for review'}</button><button type="button" className="button quiet" onClick={onClose} disabled={busy}>Keep personal</button></div>
      </form>
    </div>
  </Modal>;
}
