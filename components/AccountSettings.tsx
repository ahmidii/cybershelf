'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, KeyRound, LoaderCircle, LockKeyhole, Mail, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { ACCOUNT_ID_HEADER, AUTH_PASSWORD_MIN_LENGTH, signInPath } from '@/lib/auth-contract';
import AccountFrame from './AccountFrame';
import AccountPasswordField from './AccountPasswordField';
import styles from './Account.module.css';

type User = { userId: string; displayName: string; email: string; emailVerified: boolean };
type Action = 'password' | 'verification' | 'devices';

export default function AccountSettings({ user, emailAvailable, verificationError = false }: { user: User; emailAvailable: boolean; verificationError?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState(verificationError ? 'That verification link has expired or could not be used. Request a new link below to confirm your email.' : '');
  const [notice, setNotice] = useState('');
  const [recoveryAction, setRecoveryAction] = useState<'reload' | 'signin' | null>(null);
  const accountChanged = recoveryAction !== null;
  const [verificationSent, setVerificationSent] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  useEffect(() => () => requestRef.current?.abort(), []);

  async function request(action: Action) {
    if (requestRef.current || accountChanged) return;
    setError('');
    setNotice('');
    if (action === 'password' && newPassword !== confirmation) {
      setError('Your new passwords don’t match. Please enter the same password twice.');
      return;
    }
    const endpoint = action === 'password' ? 'change-password' : action === 'verification' ? 'send-verification-email' : 'revoke-other-sessions';
    const body = action === 'password'
      ? { currentPassword, newPassword, revokeOtherSessions: true }
      : action === 'verification' ? { email: user.email, callbackURL: `${window.location.origin}/account?verified=1` } : {};
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(action);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: user.userId },
        body: JSON.stringify(body), signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { code?: string };
        if (response.status === 429) setError('A few too many attempts. Please wait a minute, then try again.');
        else if (data.code === 'ACCOUNT_CHANGED') {
          setRecoveryAction('reload');
          setError('Your signed-in account changed in another tab. Reload this page before changing account settings.');
        } else if (data.code === 'INVALID_PASSWORD') setError('Your current password didn’t match. Please check it and try again.');
        else if (data.code === 'PASSWORD_TOO_SHORT') setError(`Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
        else if (data.code === 'PASSWORD_TOO_LONG') setError('Please choose a shorter password.');
        else if (response.status === 401 || data.code === 'SESSION_EXPIRED' || data.code === 'SESSION_IS_NOT_FRESH') {
          setRecoveryAction('signin');
          setError('Please sign in again before changing account settings.');
        } else setError('We couldn’t update your account just now. Please try again in a moment.');
        return;
      }
      if (action === 'password') {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmation('');
        setNotice('Your password has been changed. You’re still signed in here, and your other devices have been signed out.');
      } else if (action === 'verification') {
        setVerificationSent(true);
        setNotice('A verification link has been requested for your email. Check your inbox and spam folder, then open the link to confirm your address.');
      } else setNotice('Your other devices have been signed out. You’re still signed in here.');
    } catch {
      setError(controller.signal.aborted ? 'That took longer than expected. Reload to check your account before trying again.' : 'We couldn’t reach cybershelf. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
      setBusy(null);
    }
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void request('password');
  }

  return <AccountFrame wide>
    <div className={styles.intro}>
      <p className={styles.eyebrow}>YOUR LITTLE CORNER</p>
      <h1>Your account.</h1>
      <p>A few things to keep your reading life close, wherever you are.</p>
    </div>
    {error && <div className={styles.error} ref={errorRef} role="alert" tabIndex={-1}>
      <p>{error}</p>
      {accountChanged && <a className={styles.textLink} href={recoveryAction === 'signin' ? `${signInPath('/account')}&reauth=1` : '/account'}>{recoveryAction === 'signin' ? 'Sign in again' : 'Reload your account'}<ArrowRight size={14} aria-hidden="true"/></a>}
    </div>}
    {notice && <div className={styles.success} ref={noticeRef} role="status" tabIndex={-1}>{notice}</div>}

    <div className={styles.grid}>
      <div className={styles.column}>
        <section className={styles.card} aria-labelledby="account-email-heading">
          <div className={styles.sectionHeading}><Mail size={20} aria-hidden="true"/><h2 id="account-email-heading">Your email</h2></div>
          <p className={styles.accountName}>Signed in as {user.displayName}</p>
          <p className={styles.email}>{user.email}</p>
          <span className={`${styles.badge} ${user.emailVerified ? '' : styles.pending}`}>{user.emailVerified ? <><Check size={12} aria-hidden="true"/>Verified</> : 'Not verified yet'}</span>
          {user.emailVerified ? <p className={styles.hint}>Your email address is confirmed. It stays private.</p> : emailAvailable ? <>
            <p className={styles.description}>Confirm this address so you know your account emails will reach you.</p>
            <button type="button" className={`${styles.secondary} ${styles.full}`} disabled={!!busy || accountChanged || verificationSent} onClick={() => void request('verification')}>{busy === 'verification' ? <LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/> : verificationSent ? <Check size={16} aria-hidden="true"/> : <Mail size={16} aria-hidden="true"/>}{verificationSent ? 'Verification link requested' : busy === 'verification' ? 'Requesting verification…' : 'Send verification link'}</button>
            {verificationSent && <p className={styles.hint} style={{ marginTop: 12 }}>After opening the link, <a className={styles.textLink} href="/account">refresh your account</a> to see its status.</p>}
          </> : <div className={styles.notice}>
            <p>Email verification and forgotten-password recovery have not been enabled for this site yet. Keep your password somewhere safe.</p>
          </div>}
        </section>

        <section className={styles.card} aria-labelledby="account-devices-heading">
          <div className={styles.sectionHeading}><MonitorSmartphone size={20} aria-hidden="true"/><h2 id="account-devices-heading">Your devices</h2></div>
          <p className={styles.description}>Used a shared computer, or want a fresh start elsewhere? Sign out everywhere except this browser.</p>
          <button type="button" className={`${styles.secondary} ${styles.full}`} disabled={!!busy || accountChanged} onClick={() => void request('devices')}>{busy === 'devices' ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Signing out other devices…</> : <><ShieldCheck size={16} aria-hidden="true"/>Sign out other devices</>}</button>
        </section>
      </div>

      <section className={styles.card} aria-labelledby="account-password-heading">
        <div className={styles.sectionHeading}><KeyRound size={20} aria-hidden="true"/><h2 id="account-password-heading">Your password</h2></div>
        <p className={styles.description}>Changing your password also signs out your other devices. You’ll stay signed in here.</p>
        <form onSubmit={changePassword} aria-busy={busy === 'password'}>
          <fieldset className={styles.fields} disabled={!!busy || accountChanged}>
            <input type="text" name="username" value={user.email} autoComplete="username" readOnly hidden/>
            <AccountPasswordField id="current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} current/>
            <AccountPasswordField id="new-password" label="New password" value={newPassword} onChange={setNewPassword} hint={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters. A few memorable words work well.`}/>
            <AccountPasswordField id="confirm-password" label="Confirm new password" value={confirmation} onChange={setConfirmation}/>
            <button type="submit" className={`${styles.submit} ${styles.formAction}`}>{busy === 'password' ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Changing password…</> : <>Change password<ArrowRight size={16} aria-hidden="true"/></>}</button>
          </fieldset>
        </form>
        {emailAvailable && <p style={{ marginTop: 16 }}><a className={styles.textLink} href="/forgot-password">Forgot your current password?</a></p>}
      </section>
    </div>
    <p className={styles.privacy}><LockKeyhole size={14} aria-hidden="true"/><span>Your email and account settings are private. Your profile and shared shelves are managed from your reading space.</span></p>
  </AccountFrame>;
}
