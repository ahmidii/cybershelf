"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Trash2 } from 'lucide-react';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import AccountPasswordField from './AccountPasswordField';
import styles from './Account.module.css';

type Props = {
  accountId: string;
  identity: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onDeleted: (filesPending: boolean) => void;
};

export default function AccountDeletionPanel({ accountId, identity, disabled, onBusyChange, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauthenticate, setReauthenticate] = useState(false);
  const [reload, setReload] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function cancel() {
    if (requestRef.current) return;
    setOpen(false); setPassword(''); setConfirmation(''); setAcknowledged(false); setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRef.current || disabled || !acknowledged || confirmation !== 'DELETE' || !password || reauthenticate || reload) return;
    const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); onBusyChange(true); setError('');
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: accountId },
        body: JSON.stringify({ currentPassword: password, confirmation }), signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as { deleted?: boolean; filesPending?: boolean; code?: string; message?: string };
      setPassword('');
      if (response.ok && data.deleted === true && typeof data.filesPending === 'boolean') {
        setConfirmation(''); setAcknowledged(false); onDeleted(data.filesPending); return;
      }
      if (response.status === 401 || data.code === 'FRESH_SESSION_REQUIRED') {
        setReauthenticate(true); setError('Sign in again to confirm it’s you before deleting this account.');
      } else if (data.code === 'ACCOUNT_CHANGED') {
        setReload(true); setError('Your account changed, or deletion may already have been accepted. Reload before making another account request.');
      } else if (data.code === 'INVALID_PASSWORD') setError('Your current password didn’t match. Please check it and try again.');
      else if (response.status === 429) setError('A few too many attempts. Wait a minute before trying again.');
      else setError(typeof data.message === 'string' && data.message.length <= 300 ? data.message : 'We couldn’t confirm deletion. Reload to check your account before trying again.');
    } catch {
      setPassword(''); setReload(true);
      setError('We couldn’t confirm the result. Your deletion may already have been accepted. Reload to check your account; a lost connection does not cancel a deletion already received.');
    } finally {
      window.clearTimeout(timeout); requestRef.current = null; setBusy(false); onBusyChange(false);
    }
  }

  return <section className={`${styles.card} ${styles.deletionCard}`} aria-labelledby="account-delete-heading">
    <div className={styles.sectionHeading}><Trash2 size={20} aria-hidden="true"/><h2 id="account-delete-heading">Delete your account</h2></div>
    <p className={styles.description}>Permanently remove your account, library, reading journal, shared shelves, replies, follows, and uploaded files.</p>
    {!open ? <button type="button" className={`${styles.secondary} ${styles.dangerButton}`} disabled={disabled} onClick={() => setOpen(true)}>Review account deletion<ArrowRight size={15} aria-hidden="true"/></button> : <>
      <div className={styles.keyWarning}>
        <p><strong>This cannot be undone.</strong> Save any library or file exports you want to keep from Settings in your reading space first.</p>
        <p>Your sign-in and public pages are removed when deletion is accepted. File erasure may finish in the background if storage is busy. Copies downloaded by others and independent browser drafts are outside this account.</p>
        <p>Historical backups expire under the service’s backup retention policy and must not be used to restore a deleted account. Read <a href="/privacy">Privacy and your data</a> for current retention details.</p>
      </div>
      {error && <div className={styles.error} ref={errorRef} role="alert" tabIndex={-1}>
        <p>{error}</p>
        {reauthenticate && <a className={styles.textLink} href={`${signInPath('/account')}&reauth=1`}>Sign in again</a>}
        {reload && <a className={styles.textLink} href="/account">Check account status</a>}
      </div>}
      <form className={styles.formSpacing} onSubmit={submit} aria-busy={busy}>
        <fieldset className={styles.fields} disabled={busy || disabled || reauthenticate || reload}>
          <p className={styles.accountName}>Deleting the account signed in as <strong>{identity}</strong>.</p>
          <input type="text" name="username" value={identity} autoComplete="username" readOnly hidden/>
          <AccountPasswordField id="delete-account-password" label="Current password" value={password} onChange={setPassword} current/>
          <div className={styles.field}>
            <label htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
            <input id="delete-account-confirmation" name="confirmation" autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={6} value={confirmation} onChange={event => setConfirmation(event.target.value)}/>
          </div>
          <label className={styles.keyAcknowledgement}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>I have saved anything I need and understand that this account cannot be restored.</span></label>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.submit} ${styles.deleteSubmit}`} disabled={!password || confirmation !== 'DELETE' || !acknowledged}>{busy ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Deleting account…</> : <><Trash2 size={16} aria-hidden="true"/>Permanently delete account</>}</button>
            <button type="button" className={styles.secondary} onClick={cancel}>Keep my account</button>
          </div>
        </fieldset>
      </form>
    </>}
  </section>;
}
