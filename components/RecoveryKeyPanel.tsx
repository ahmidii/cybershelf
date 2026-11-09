'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, Download, KeyRound, LoaderCircle } from 'lucide-react';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import styles from './Account.module.css';

/** A freshly issued recovery key lives only in the caller's component state.
 * The reader may explicitly copy or download it; it is never put in a URL or
 * browser storage. Leaving before acknowledgement warns about losing it. */
export default function RecoveryKeyPanel({ recoveryKey, username, accountId, replacing = false, onDone, onAccountChanged, continueLabel = 'I saved my key' }: {
  recoveryKey: string;
  username: string;
  accountId?: string;
  replacing?: boolean;
  onDone: () => void;
  onAccountChanged?: () => void;
  continueLabel?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false), [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState(''), [checking, setChecking] = useState(!!accountId);
  const [checkError, setCheckError] = useState(''), [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null), finished = useRef(false);
  const changed = useRef(onAccountChanged);
  useEffect(() => { changed.current = onAccountChanged; }, [onAccountChanged]);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (finished.current) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (!accountId) return;
    let controller: AbortController | null = null, active = true, generation = 0;
    const verify = async () => {
      controller?.abort(); controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), request = ++generation;
      setChecking(true); setCheckError('');
      try {
        const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin', headers: { [ACCOUNT_ID_HEADER]: accountId }, signal });
        if (!active || request !== generation) return;
        if (response.status === 401 || response.status === 409) { finished.current = true; changed.current?.(); return; }
        if (!response.ok) throw new Error('Your account could not be checked. Your key is hidden until the check succeeds.');
        const data = await response.json() as { user?: { id?: string } };
        if (!active || request !== generation) return;
        if (data.user?.id !== accountId) { finished.current = true; changed.current?.(); return; }
        setChecking(false);
      } catch {
        if (active && request === generation) {
          setCheckError('Your account could not be checked. Reconnect and try again to show your key.');
          setChecking(false);
        }
      }
    };
    const focus = () => { if (document.visibilityState === 'visible') void verify(); };
    const visibility = () => {
      if (document.visibilityState === 'visible') void verify();
      else { generation++; controller?.abort(); setChecking(true); }
    };
    void verify(); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility);
    return () => { active = false; generation++; controller?.abort(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility); };
  }, [accountId, retry]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(recoveryKey); setCopied(true); setNotice('Recovery key copied. Save it somewhere private.'); }
    catch { setNotice('Copy was unavailable. Select the key below and copy it, or download the file.'); }
  };
  const download = () => {
    const contents = `cybershelf recovery key\n\nUsername: ${username}\nRecovery key: ${recoveryKey}\n\nKeep this file private. Anyone with this key can reset your password.\nRecover at ${window.location.origin}/forgot-password\nA successful recovery gives you a new key and invalidates this one.\nThis file contains no password. Store it somewhere safe.\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cybershelf-recovery-key.txt';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setNotice('Recovery file prepared. Keep it private and check that it was saved.');
  };

  return <section className={styles.keyPanel} aria-labelledby="recovery-key-heading">
    <div className={styles.sectionHeading}><KeyRound size={20} aria-hidden="true"/><h2 id="recovery-key-heading" ref={heading} tabIndex={-1}>Keep your recovery key.</h2></div>
    <p className={styles.description}>Save it with your username, <strong>{username}</strong>, in a password manager or another private place. You’ll need it if you forget your password.</p>
    {replacing && <p className={styles.hint}>This new key replaces your previous one. The previous key no longer works.</p>}
    {checking ? <p className={styles.keyChecking} role="status"><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Checking your account…</p> : checkError ? <div className={styles.notice} role="status"><p>{checkError}</p><button type="button" className={styles.textLink} onClick={() => setRetry(value => value + 1)}>Check again</button></div> : <>
      <label className={styles.keyLabel} htmlFor="issued-recovery-key">Your recovery key</label>
      <textarea id="issued-recovery-key" className={styles.keyValue} value={recoveryKey} readOnly autoComplete="off" autoCapitalize="none" spellCheck={false} rows={3} onFocus={event => event.currentTarget.select()}/>
      <div className={styles.keyActions}>
        <button type="button" className={styles.secondary} onClick={() => void copy()}>{copied ? <Check size={15} aria-hidden="true"/> : <Copy size={15} aria-hidden="true"/>}{copied ? 'Copied' : 'Copy key'}</button>
        <button type="button" className={styles.secondary} onClick={download}><Download size={15} aria-hidden="true"/>Download key</button>
      </div>
      <p className={styles.keyWarning}>Anyone with this key can reset your password. Never share it or post it in a public issue. For an account without email, losing both your password and this key means access cannot be restored.</p>
      <p className={styles.hint}>This key is shown only here. It won’t be available to view again after you leave.</p>
      {notice && <p className={styles.hint} role="status">{notice}</p>}
      <label className={styles.keyAcknowledgement}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>I’ve saved my username and recovery key somewhere safe.</span></label>
      <button type="button" className={`${styles.submit} ${styles.full}`} disabled={!acknowledged} onClick={() => { finished.current = true; onDone(); }}>{continueLabel}<ArrowRight size={16} aria-hidden="true"/></button>
    </>}
  </section>;
}
