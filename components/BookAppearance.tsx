'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { assetUrl, type Asset, type Book, type BookFormat } from '@/lib/types';
import { BookOpen, Camera, ChevronDown, ImagePlus, Link2, Ruler, LoaderCircle, RotateCcw } from 'lucide-react';
import { BOOK_FORMATS, DIMENSION_LIMITS, bookDimensions, normalizeBookISBN, type EditionAppearance } from '@/lib/book-size';
import { pageCountPatch } from '@/lib/reading-progress';
import { SPINE_IMAGE_TYPES, SPINE_PHOTO_MAX_BYTES, spineCopyIdentity, validSpineImage } from '@/lib/spine-image';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import SpinePhotoEditor from './SpinePhotoEditor';
import styles from './BookAppearance.module.css';

type SpinePhoto = { file: File; copy: string; accountId: string; key: number };

function spineInk(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#fff9ec';
  const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  return r * .299 + g * .587 + b * .114 > 164 ? '#342f27' : '#fff9ec';
}

export default function BookAppearance({ book, onChange, accountId }: { book: Book; onChange: (book: Book) => void; accountId: string | null }) {
  const current = useRef(book); current.current = book;
  const currentAccount = useRef(accountId); currentAccount.current = accountId;
  const live = useRef(true);
  const size = bookDimensions(book);
  const [draft, setDraft] = useState({ heightMm: String(size.heightMm / 10), widthMm: String(size.widthMm / 10), thicknessMm: String(size.thicknessMm / 10) });
  const [spine, setSpine] = useState(book.spineUrl ?? ''), [failedUrl, setFailedUrl] = useState('');
  const [busy, setBusy] = useState(false), [note, setNote] = useState(''), [error, setError] = useState('');
  const [photo, setPhoto] = useState<SpinePhoto | null>(null), [uploading, setUploading] = useState(false);
  const photoSequence = useRef(0);
  const copy = spineCopyIdentity(book);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => setDraft({ heightMm: String(size.heightMm / 10), widthMm: String(size.widthMm / 10), thicknessMm: String(size.thicknessMm / 10) }), [size.heightMm, size.widthMm, size.thicknessMm]);
  useEffect(() => { setSpine(book.spineUrl ?? ''); setFailedUrl(''); }, [book.spineUrl]);
  useEffect(() => {
    if (photo && (photo.copy !== copy || photo.accountId !== accountId)) {
      setPhoto(null); setError('The selected copy changed. Choose its spine photo again.');
    }
  }, [photo, copy, accountId]);
  const change = (patch: Partial<Book>) => onChange({ ...current.current, ...patch });
  const saveDimension = (key: 'heightMm' | 'widthMm' | 'thicknessMm') => {
    const value = Number(draft[key]) * 10, limit = DIMENSION_LIMITS[key];
    if (!draft[key].trim() || !Number.isFinite(value) || value < limit.min || value > limit.max) {
      setError(`Use a value between ${limit.min / 10} and ${limit.max / 10} cm.`);
      setDraft(previous => ({ ...previous, [key]: String(bookDimensions(current.current)[key] / 10) })); return;
    }
    setError('');
    const prior = bookDimensions(current.current);
    if (Math.abs(prior[key] - value) < .05) return;
    change({ dimensions: { ...prior, [key]: Math.round(value * 10) / 10, source: 'manual' } });
  };
  const lookup = async () => {
    const isbn = normalizeBookISBN(current.current.isbn), id = current.current.id; if (!isbn) return;
    setBusy(true); setError(''); setNote('');
    try {
      const response = await fetch('/api/book-details?isbn=' + encodeURIComponent(isbn), { signal: AbortSignal.timeout(5500) });
      const data = await response.json() as { edition?: EditionAppearance | null; error?: string };
      if (!response.ok) throw new Error(data.error || 'Edition details are unavailable. Your current size is kept.');
      if (!live.current || current.current.id !== id || normalizeBookISBN(current.current.isbn) !== isbn) return;
      const edition = data.edition;
      if (!edition) { setNote('No matching edition was found. The estimated size still works on your shelf.'); return; }
      const hasManualSize = current.current.dimensions?.source === 'manual';
      change({ ...(edition.pages ? pageCountPatch(current.current, edition.pages) : {}), ...(edition.format ? { format: edition.format } : {}), ...(!hasManualSize && edition.dimensions ? { dimensions: edition.dimensions } : {}), ...(!current.current.coverUrl && edition.coverUrl ? { coverUrl: edition.coverUrl } : {}) });
      setNote(hasManualSize ? 'Edition details checked. Your custom measurements were kept.' : edition.dimensions?.source === 'catalog' ? 'Measurements found for this ISBN.' : edition.dimensions ? 'Size estimated from this edition’s catalog description.' : 'Edition details checked. A complete measured size is unavailable, so the shelf uses an estimate.');
    } catch (caught) {
      if (live.current) setError(caught instanceof Error && caught.name === 'TimeoutError' ? 'The catalog is taking longer than usual. Your current size is kept.' : caught instanceof Error ? caught.message : 'Could not check this edition. Your current size is kept.');
    } finally { if (live.current) setBusy(false); }
  };
  const selectPhoto = (file: File | undefined) => {
    if (!file || uploading) return;
    if (!accountId) { setError('Sign in to save a spine photo.'); return; }
    if (!SPINE_IMAGE_TYPES.has(file.type) || !file.size || file.size > SPINE_PHOTO_MAX_BYTES) { setError('Choose a PNG, JPEG, or WebP photo up to 20 MB.'); return; }
    setError(''); setNote('');
    setPhoto({ file, copy: spineCopyIdentity(current.current), accountId, key: ++photoSequence.current });
  };
  const uploadSpine = async (file: File) => {
    const selected = photo;
    if (!selected || !live.current || uploading) throw new Error('Choose the spine photo again.');
    const sameCopy = () => live.current && spineCopyIdentity(current.current) === selected.copy && currentAccount.current === selected.accountId;
    if (!sameCopy()) throw new Error('The selected copy changed. Choose its spine photo again.');
    if (!file.size || file.size > 4 * 1024 * 1024) throw new Error('The cropped image is too large. Try a smaller photo.');
    setUploading(true); setError(''); setNote('');
    try {
      const body = new FormData(); body.append('file', file); body.append('kind', 'image');
      const response = await fetch('/api/assets', { method: 'POST', headers: { [ACCOUNT_ID_HEADER]: selected.accountId }, body, signal: AbortSignal.timeout(30000) });
      const data = await response.json() as Asset & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not save this spine image.');
      if (!sameCopy()) throw new Error('The selected copy changed. Its spine was left unchanged.');
      change({ spineUrl: assetUrl(data.id) }); setPhoto(null);
      setNote('Your spine is ready for upright, leaning, and stacked books. It stays private until you share a shelf, profile, or reading update that uses it.');
    } finally { if (live.current) setUploading(false); }
  };
  const saveSpineLink = () => {
    const value = spine.trim();
    if (!value || !validSpineImage(value)) { setError('Use a complete http:// or https:// image URL without sign-in details.'); return; }
    change({ spineUrl: value }); setSpine(value); setError(''); setPhoto(null);
    setNote('Spine image linked to this copy. Check the preview to make sure it matches your edition.');
  };
  const sourceLabel = size.source === 'manual' ? 'Custom size' : size.source === 'catalog' ? 'Catalog measurements' : 'Estimated size';
  const hasSpine = !!book.spineUrl && failedUrl !== book.spineUrl;
  const isbn = normalizeBookISBN(book.isbn);
  return <>
    <section className={styles.spinePanel} aria-label="Book spine artwork">
      <div className={styles.spineOverview}>
        <div className={styles.spinePreview} aria-label={hasSpine ? 'Your saved spine image' : 'Typographic spine preview'} style={{ '--spine-color': book.color, '--spine-ink': spineInk(book.color), width: Math.max(18, Math.min(80, 180 * size.thicknessMm / size.heightMm)) } as CSSProperties}>
          {hasSpine ? <img src={book.spineUrl} alt={`Spine of ${book.title}`} draggable={false} onError={() => setFailedUrl(book.spineUrl ?? '')}/> : <span><strong>{book.title}</strong><small>{book.author}</small></span>}
        </div>
        <div className={styles.spineCopy}>
          <span className={styles.spineBadge}>{hasSpine ? 'Your spine image' : 'Typographic spine'}</span>
          <h4>The spine on your shelf</h4>
          <p>{hasSpine ? 'This artwork follows your copy when you stand it, lean it, or stack it.' : 'Match your edition with a photo of its spine. Frame it here and preview it before saving.'}</p>
          <span className={styles.editionLabel}>{isbn ? `ISBN ${isbn}` : book.editionId ? `Edition ${book.editionId}` : 'Your copy · add its ISBN above to identify the edition'}</span>
          {accountId ? <div className={styles.spineButtons}>
            <label className={`button secondary small ${uploading ? 'disabled' : ''}`}><ImagePlus size={15}/>{hasSpine ? 'Replace photo' : 'Choose photo'}<input type="file" className="sr-only" aria-label="Choose a spine photo" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => { selectPhoto(event.target.files?.[0]); event.target.value = ''; }}/></label>
            <label className={`button quiet small ${uploading ? 'disabled' : ''}`}><Camera size={15}/>Take photo<input type="file" className="sr-only" aria-label="Take a spine photo" accept="image/png,image/jpeg,image/webp" capture="environment" disabled={uploading} onChange={event => { selectPhoto(event.target.files?.[0]); event.target.value = ''; }}/></label>
          </div> : <p className={styles.signInHint}>Sign in to save a spine photo, or use an image link below.</p>}
          {book.spineUrl && <button type="button" className={styles.removeSpine} disabled={uploading} onClick={() => { change({ spineUrl: undefined }); setSpine(''); setError(''); setNote('Using a typographic spine for this copy.'); }}>Use a typographic spine</button>}
        </div>
      </div>
      {book.spineUrl && !hasSpine && <p className="notice error" role="status">This spine image could not be loaded. Your shelf will use the typographic spine until you replace it.</p>}
      {photo && <SpinePhotoEditor key={photo.key} file={photo.file} ratio={size.thicknessMm / size.heightMm} onSave={uploadSpine} onCancel={() => setPhoto(null)}/>}
      <details className={styles.spineLink}>
        <summary><Link2 size={14}/>Use an image link<ChevronDown size={14}/></summary>
        <div><label className="field">Spine image URL<input type="url" maxLength={2048} value={spine} disabled={uploading} placeholder="https://…" onChange={event => setSpine(event.target.value)}/></label><button type="button" className="button secondary small" disabled={uploading || !spine.trim()} onClick={saveSpineLink}>Use image</button></div>
        <p className={styles.hint}>Choose an upright, tightly cropped spine from your edition. Front-cover images don’t show the spine.</p>
      </details>
      <p className={styles.spineSourceNote}>Catalogs supply front covers, but a matching spine isn’t always available. Until you add one, the title, author, and color form a typographic spine.</p>
    </section>
    <details className={styles.appearance}>
      <summary><Ruler size={19}/><span><strong>Size & edition details</strong><small>{(size.heightMm / 10).toFixed(1)} × {(size.widthMm / 10).toFixed(1)} × {(size.thicknessMm / 10).toFixed(1)} cm · {sourceLabel}</small></span><ChevronDown size={17}/></summary>
      <div className={styles.body}>
        <p className={styles.hint}>Your book gets a size automatically. Fine-tune it here if you know your edition’s measurements.</p>
        <div className="form-grid">
          <label className="field">Format<select value={book.format ?? 'paperback'} onChange={event => change({ format: event.target.value as BookFormat, dimensions: undefined })}>{BOOK_FORMATS.map(format => <option key={format.id} value={format.id}>{format.name}</option>)}</select></label>
          <label className="field">Pages<input key={book.pages ?? 'no-pages'} type="number" inputMode="numeric" min="1" max="100000" step="1" defaultValue={book.pages ?? ''} placeholder="Total pages" onBlur={event => {
            const raw = event.target.value.trim(), pages = Number(raw);
            if (!raw || pages === 0) { change({ ...pageCountPatch(current.current, undefined), ...(current.current.dimensions?.source === 'estimated' ? { dimensions: undefined } : {}) }); setError(''); }
            else if (Number.isInteger(pages) && pages > 0 && pages <= 100000) { if (pages !== current.current.pages) change({ ...pageCountPatch(current.current, pages), ...(current.current.dimensions?.source === 'estimated' ? { dimensions: undefined } : {}) }); setError(''); }
            else { setError('Page count must be a whole number between 1 and 100,000.'); event.target.value = String(current.current.pages ?? ''); }
          }}/></label>
        </div>
        <div className={styles.measurements}>
          {([['heightMm', 'Height'], ['widthMm', 'Cover width'], ['thicknessMm', 'Spine thickness']] as const).map(([key, label]) => <label className="field" key={key}>{label}<span className={styles.inputUnit}><input type="number" inputMode="decimal" step="0.1" min={DIMENSION_LIMITS[key].min / 10} max={DIMENSION_LIMITS[key].max / 10} value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} onBlur={() => saveDimension(key)}/><span>cm</span></span></label>)}
        </div>
        <div className={styles.actions}>
          <button type="button" className="text-button" onClick={() => { change({ dimensions: undefined }); setError(''); setNote('Using a size estimate based on format and page count.'); }}><RotateCcw size={14}/>Use automatic size</button>
          {isbn && <button type="button" className="button secondary small" disabled={busy} onClick={() => void lookup()}>{busy ? <LoaderCircle size={14} className="spin"/> : <BookOpen size={14}/>} {busy ? 'Checking edition…' : 'Check this ISBN'}</button>}
        </div>
        <p className={styles.hint}>{size.source === 'catalog' ? 'The catalog provides all three labelled measurements for this ISBN. Check them against your copy for precise planning.' : size.source === 'manual' ? 'Your custom size is used on every shelf.' : 'An approximation for arranging books. Editions and paper thickness vary; this is not a measurement of your copy.'}</p>
      </div>
    </details>
    {note && <p className="notice" role="status">{note}</p>}{error && <p className="notice error" role="alert">{error}</p>}
  </>;
}
