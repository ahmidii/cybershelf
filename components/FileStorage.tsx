"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, HardDrive, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import accountStyles from './Account.module.css';
import styles from './FileStorage.module.css';

type StoredFile = { id: string; filename: string; mime: string; size: number };
type StorageUsage = { usedBytes: number; pendingBytes: number; pendingFiles: number; limitBytes: number };
const amount = (bytes: number) => bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024
  ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';

export default function FileStorage({ accountId, disabled = false }: { accountId: string; disabled?: boolean }) {
  const [files, setFiles] = useState<StoredFile[]>([]), [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirm, setConfirm] = useState<string | null>(null);
  const [visible, setVisible] = useState(20);
  const currentRequest = useRef<AbortController | null>(null), alive = useRef(true);

  const accountChanged = useCallback(() => {
    setFiles([]); setUsage(null); setConfirm(null); setBlocked(true);
    setError('Your signed-in account changed or expired. Reload this page before managing files.');
  }, []);

  const load = useCallback(async () => {
    if (currentRequest.current || !alive.current) return;
    const controller = new AbortController(); currentRequest.current = controller;
    setBusy(true); setFiles([]); setUsage(null); setConfirm(null); setError('');
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch('/api/assets', { cache: 'no-store', credentials: 'same-origin',
        headers: { [ACCOUNT_ID_HEADER]: accountId }, signal: controller.signal });
      const body = await response.json() as Record<string, unknown>;
      if (!alive.current || currentRequest.current !== controller) return;
      if (response.status === 401 || body.code === 'ACCOUNT_CHANGED') { accountChanged(); return; }
      if (!response.ok || !Array.isArray(body.assets) || typeof body.usedBytes !== 'number' || typeof body.limitBytes !== 'number' || body.limitBytes <= 0) {
        throw new Error('Your files could not be loaded. Try refreshing in a moment.');
      }
      const values = body.assets.filter((file): file is StoredFile => !!file && typeof file === 'object'
        && typeof file.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(file.id)
        && typeof file.filename === 'string' && typeof file.mime === 'string' && typeof file.size === 'number' && file.size >= 0);
      setFiles(values); setUsage({ usedBytes: body.usedBytes, limitBytes: body.limitBytes,
        pendingBytes: typeof body.pendingBytes === 'number' ? body.pendingBytes : 0,
        pendingFiles: typeof body.pendingFiles === 'number' ? body.pendingFiles : 0 });
      setLoaded(true); setBlocked(false);
    } catch {
      if (alive.current && currentRequest.current === controller) setError('Your files could not be loaded. Check your connection and try refreshing.');
    } finally {
      clearTimeout(timeout); const current = alive.current && currentRequest.current === controller;
      if (currentRequest.current === controller) currentRequest.current = null;
      if (current) setBusy(false);
    }
  }, [accountId, accountChanged]);

  useEffect(() => {
    alive.current = true; setLoaded(false); setBlocked(false); setNotice(''); setVisible(20); void load();
    const check = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { alive.current = false; currentRequest.current?.abort(); currentRequest.current = null;
      window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [load]);

  async function remove(file: StoredFile) {
    if (currentRequest.current || blocked || disabled || confirm !== file.id) return;
    const controller = new AbortController(); currentRequest.current = controller; setBusy(true); setError(''); setNotice('');
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let refresh = false;
    try {
      const response = await fetch('/api/assets/' + encodeURIComponent(file.id), { method: 'DELETE', cache: 'no-store', credentials: 'same-origin',
        headers: { [ACCOUNT_ID_HEADER]: accountId }, signal: controller.signal });
      const body = await response.json() as Record<string, unknown>;
      if (!alive.current || currentRequest.current !== controller) return;
      if (response.status === 401 || body.code === 'ACCOUNT_CHANGED') { accountChanged(); return; }
      if (!response.ok) {
        setError(typeof body.error === 'string' && body.error.length <= 400 ? body.error : 'The file could not be removed. Please refresh and try again.');
        return;
      }
      setConfirm(null); refresh = true;
      setNotice(body.cleanupPending ? 'The file is no longer accessible. Storage cleanup is queued and its space will become available after cleanup finishes.' : 'The unused file was removed.');
    } catch {
      if (alive.current && currentRequest.current === controller) { setConfirm(null); setError('The response was interrupted. Refresh the file list before trying again; the removal may already have completed.'); }
    } finally {
      clearTimeout(timeout); const current = alive.current && currentRequest.current === controller;
      if (currentRequest.current === controller) currentRequest.current = null;
      if (current) { setBusy(false); if (refresh) void load(); }
    }
  }

  const unavailable = busy || disabled || blocked;
  const percentage = usage ? Math.min(100, Math.max(0, usage.usedBytes / usage.limitBytes * 100)) : 0;
  return <section className={accountStyles.card} aria-labelledby="account-storage-heading" aria-busy={busy}>
    <div className={accountStyles.sectionHeading}><HardDrive size={20} aria-hidden="true"/><h2 id="account-storage-heading">Files and storage</h2></div>
    <p className={accountStyles.description}>Your uploaded originals and artwork stay private until you deliberately share artwork. Download a copy before permanently removing an unused file.</p>
    {usage && <div className={styles.usage}>
      <p><strong>{amount(usage.usedBytes)}</strong> of {amount(usage.limitBytes)} used</p>
      <div className={styles.meter} role="progressbar" aria-label="Account file storage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)} aria-valuetext={`${amount(usage.usedBytes)} of ${amount(usage.limitBytes)} used`}><span style={{ width: percentage + '%' }}/></div>
      {usage.pendingFiles > 0 && <p className={accountStyles.hint}>{usage.pendingFiles} pending upload or cleanup {usage.pendingFiles === 1 ? 'reserves' : 'reserve'} {amount(usage.pendingBytes)}. Refresh after it finishes.</p>}
    </div>}
    <button type="button" className={accountStyles.textLink} onClick={() => void load()} disabled={busy || disabled}>{busy ? <LoaderCircle size={14} className={accountStyles.spinner} aria-hidden="true"/> : <RefreshCw size={14} aria-hidden="true"/>}Refresh files</button>
    {error && <p className={styles.error} role="alert">{error}{blocked && <> <a href="/account">Reload account</a></>}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loaded && !busy && !blocked && files.length === 0 && <p className={accountStyles.hint}>No uploaded files in this account.</p>}
    {files.length > 0 && <ul className={styles.list}>
      {files.slice(0, visible).map(file => <li key={file.id}>
        <div className={styles.file}><span className={styles.filename}>{file.filename}</span><small>{amount(file.size)} · {file.mime === 'application/pdf' ? 'PDF' : file.mime === 'application/epub+zip' ? 'EPUB' : 'Artwork'}</small></div>
        <div className={styles.actions}>
          <a href={'/api/assets/' + encodeURIComponent(file.id)} download={file.filename} aria-label={'Download ' + file.filename} aria-disabled={unavailable} onClick={event => { if (unavailable) event.preventDefault(); }}><Download size={16} aria-hidden="true"/></a>
          <button type="button" aria-label={'Remove ' + file.filename} disabled={unavailable} onClick={() => { setConfirm(file.id); setError(''); setNotice(''); }}><Trash2 size={16} aria-hidden="true"/></button>
        </div>
        {confirm === file.id && <div className={styles.confirm}><p>Permanently remove this file? Books, artwork, or shared shelves still using it must be updated first.</p>
          <button type="button" disabled={unavailable} onClick={() => void remove(file)}>Remove permanently</button>
          <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Keep file</button>
        </div>}
      </li>)}
    </ul>}
    {files.length > visible && <button type="button" className={accountStyles.textLink} disabled={unavailable} onClick={() => setVisible(count => count + 20)}>Show more files</button>}
  </section>;
}
