"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, KeyRound, LoaderCircle, LockKeyhole, Mail, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react';
import { ACCOUNT_ID_HEADER, AUTH_PASSWORD_MIN_LENGTH, signInPath } from '@/lib/auth-contract';
import { AUTH_USERNAME_MAX_LENGTH, AUTH_USERNAME_MIN_LENGTH, normalizeUsername, usernameValidationError } from '@/lib/account-identity';
import AccountFrame from './AccountFrame';
import AccountPasswordField from './AccountPasswordField';
import RecoveryKeyPanel from './RecoveryKeyPanel';
import AccountDeletionPanel from './AccountDeletionPanel';
import FileStorage from './FileStorage';
import styles from './Account.module.css';

type User = { userId: string; displayName: string; username: string | null; email: string | null; emailVerified: boolean };
type Action = 'password' | 'verification' | 'devices' | 'username' | 'key';
type ResponseData = { code?: string; message?: string; username?: string; recoveryKey?: string };

export default function AccountSettings({ user, emailAvailable, verificationError = false }: { user: User; emailAvailable: boolean; verificationError?: boolean }) {
  const [accountUsername, setAccountUsername] = useState(user.username);
  const [chosenUsername, setChosenUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [keyPassword, setKeyPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [issuedKey, setIssuedKey] = useState<{ value: string; username: string } | null>(null);
  const [busy, setBusy] = useState<Action | 'delete' | null>(null);
  const [deleted, setDeleted] = useState<{ filesPending: boolean } | null>(null);
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

  function clearPasswords() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setUsernamePassword('');
    setKeyPassword('');
  }

  function changedAccount() {
    setIssuedKey(null);
    clearPasswords();
    setRecoveryAction('reload');
    setError('Your signed-in account changed in another tab. Reload this page before changing account settings.');
  }

  async function request(action: Action) {
    if (requestRef.current || accountChanged || issuedKey || busy === 'delete') return;
    if ((action === 'verification' && !user.email) || (action === 'key' && !accountUsername) || (action === 'username' && accountUsername)) return;
    setError('');
    setNotice('');
    if (action === 'password' && newPassword !== confirmation) {
      setError('Your new passwords don’t match. Please enter the same password twice.');
      return;
    }
    if (action === 'username') {
      const validation = usernameValidationError(chosenUsername);
      if (validation) { setError(validation); return; }
    }
    const endpoint = action === 'username' ? '/api/account/username'
      : action === 'key' ? '/api/account/recovery-key'
        : `/api/auth/${action === 'password' ? 'change-password' : action === 'verification' ? 'send-verification-email' : 'revoke-other-sessions'}`;
    const body = action === 'password' ? { currentPassword, newPassword, revokeOtherSessions: true }
      : action === 'verification' ? { email: user.email, callbackURL: `${window.location.origin}/account?verified=1` }
        : action === 'username' ? { username: normalizeUsername(chosenUsername), currentPassword: usernamePassword }
          : action === 'key' ? { currentPassword: keyPassword } : {};
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(action);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: user.userId },
        body: JSON.stringify(body), signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as ResponseData;
      if (!response.ok) {
        if (response.status === 429) setError('A few too many attempts. Please wait a minute, then try again.');
        else if (data.code === 'ACCOUNT_CHANGED') changedAccount();
        else if (data.code === 'INVALID_PASSWORD') setError('Your current password didn’t match. Please check it and try again.');
        else if (data.code === 'PASSWORD_POLICY') setError(typeof data.message === 'string' && data.message.trim() && data.message.length <= 240 ? data.message : `Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
        else if (data.code === 'PASSWORD_TOO_SHORT') setError(`Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
        else if (data.code === 'PASSWORD_TOO_LONG') setError('Please choose a shorter password.');
        else if (data.code === 'USERNAME_TAKEN' || data.code === 'USERNAME_IS_ALREADY_TAKEN') setError('That username is already in use. Please choose another.');
        else if (data.code === 'INVALID_USERNAME') setError(usernameValidationError(chosenUsername) || 'Please choose another username. Use 3–30 letters, numbers, or underscores, with a letter or number at each end.');
        else if (data.code === 'USERNAME_ALREADY_SET') {
          clearPasswords();
          setRecoveryAction('reload');
          setError('A username has already been chosen for this account. Reload to see it.');
        } else if (data.code === 'USERNAME_REQUIRED') {
          clearPasswords();
          setRecoveryAction('reload');
          setError('Choose a username before generating a recovery key. Reload your account to choose one.');
        } else if (response.status === 401 || ['SESSION_EXPIRED', 'SESSION_IS_NOT_FRESH', 'FRESH_SESSION_REQUIRED'].includes(data.code ?? '')) {
          clearPasswords();
          setRecoveryAction('signin');
          setError('Please sign in again before changing account settings. This keeps sensitive changes tied to a recent sign-in.');
        } else setError('We couldn’t update your account just now. Please try again in a moment.');
        return;
      }
      if (action === 'password') {
        clearPasswords();
        setNotice('Your password has been changed. You’re still signed in here, and your other devices have been signed out.');
      } else if (action === 'verification') {
        setVerificationSent(true);
        setNotice('A verification link has been requested for your email. Check your inbox and spam folder, then open the link to confirm your address.');
      } else if (action === 'username') {
        setUsernamePassword('');
        if (typeof data.username !== 'string' || usernameValidationError(data.username)) {
          clearPasswords();
          setRecoveryAction('reload');
          setError('Your username may have been saved. Reload your account to check it before continuing.');
          return;
        }
        setAccountUsername(data.username);
        setChosenUsername('');
        setNotice('Your username is ready. You can now use it to sign in and create a recovery key below. Your existing email sign-in still works.');
      } else if (action === 'key') {
        clearPasswords();
        if (typeof data.recoveryKey !== 'string' || !data.recoveryKey || data.recoveryKey.length > 512) {
          setError('Your recovery key may have changed, but the new key could not be displayed. Your password still works. Generate another key here before relying on key recovery.');
          return;
        }
        setIssuedKey({ value: data.recoveryKey, username: accountUsername! });
      } else setNotice('Your other devices have been signed out. You’re still signed in here.');
    } catch {
      setError(action === 'key'
        ? 'We couldn’t confirm that your new recovery key arrived. Your previous key may have been replaced. Your password still works; reconnect and generate another key here.'
        : controller.signal.aborted ? 'That took longer than expected. Reload to check your account before trying again.' : 'We couldn’t reach cybershelf. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, action: Action) {
    event.preventDefault();
    void request(action);
  }

  if (deleted) return <AccountFrame wide>
    <section className={styles.card}>
      <div className={styles.icon}><Check size={22} aria-hidden="true"/></div>
      <h1>Your account has been deleted.</h1>
      <p className={styles.description}>Your sign-in, library, journal, and public account content have been removed. You have been signed out on every device.</p>
      {deleted.filesPending ? <p className={styles.notice}>Your uploaded files are no longer accessible. Their removal from storage is queued and will continue automatically; you do not need to stay on this page.</p> : <p className={styles.notice}>Your uploaded file contents have also been removed from active storage.</p>}
      <p className={styles.hint}>Downloaded copies and browser guest drafts are separate. Historical backups expire according to the backup retention policy; erased accounts must be excluded from any restore.</p>
      <a className={styles.textLink} href="/">Return to cybershelf<ArrowRight size={15} aria-hidden="true"/></a>
    </section>
  </AccountFrame>;

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

    {issuedKey ? <section className={styles.card}>
      <RecoveryKeyPanel recoveryKey={issuedKey.value} username={issuedKey.username} accountId={user.userId} replacing onAccountChanged={changedAccount} onDone={() => { setIssuedKey(null); setNotice('Your new recovery key is ready. Keep it somewhere private, along with your username.'); }}/>
    </section> : <div className={styles.grid}>
      <div className={styles.column}>
        <section className={styles.card} aria-labelledby="account-identity-heading">
          <div className={styles.sectionHeading}><UserRound size={20} aria-hidden="true"/><h2 id="account-identity-heading">Your sign-in</h2></div>
          <p className={styles.accountName}>Signed in as {user.displayName}</p>
          {accountUsername ? <>
            <p className={styles.identityLabel}>Username</p>
            <p className={styles.identityName}>{accountUsername}</p>
            <p className={styles.hint}>Use this username to sign in. You can change your display name from your profile; your sign-in username stays the same.</p>
          </> : <>
            <p className={styles.description}>Choose a username to sign in without typing your email. Your existing email sign-in will keep working.</p>
            <form className={styles.formSpacing} onSubmit={event => submit(event, 'username')} aria-busy={busy === 'username'}>
              <fieldset className={styles.fields} disabled={!!busy || accountChanged}>
                <div className={styles.field}>
                  <label htmlFor="claim-username">Choose your username</label>
                  <input id="claim-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={AUTH_USERNAME_MIN_LENGTH} maxLength={AUTH_USERNAME_MAX_LENGTH} value={chosenUsername} onChange={event => setChosenUsername(event.target.value)} aria-describedby="claim-username-hint"/>
                  <p className={styles.hint} id="claim-username-hint">3–30 letters, numbers, or underscores, with a letter or number at each end. Choose carefully: usernames can’t be changed yet.</p>
                </div>
                <AccountPasswordField id="username-password" label="Current password" value={usernamePassword} onChange={setUsernamePassword} current/>
                <button type="submit" className={styles.submit}>{busy === 'username' ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Saving username…</> : <>Save username<ArrowRight size={16} aria-hidden="true"/></>}</button>
              </fieldset>
            </form>
          </>}
          <div className={styles.emailSection}>
            <div className={styles.sectionHeading}><Mail size={18} aria-hidden="true"/><h3>Email</h3></div>
            {user.email ? <>
              <p className={styles.email}>{user.email}</p>
              <span className={`${styles.badge} ${user.emailVerified ? '' : styles.pending}`}>{user.emailVerified ? <><Check size={12} aria-hidden="true"/>Verified</> : 'Not verified yet'}</span>
              {user.emailVerified ? <p className={styles.hint}>Your email address is confirmed. It stays private and can be used for password recovery.</p> : emailAvailable ? <>
                <p className={styles.description}>Confirm this address so you know your account emails will reach you.</p>
                <button type="button" className={`${styles.secondary} ${styles.full} ${styles.formSpacing}`} disabled={!!busy || accountChanged || verificationSent} onClick={() => void request('verification')}>{busy === 'verification' ? <LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/> : verificationSent ? <Check size={16} aria-hidden="true"/> : <Mail size={16} aria-hidden="true"/>}{verificationSent ? 'Verification link requested' : busy === 'verification' ? 'Requesting verification…' : 'Send verification link'}</button>
                {verificationSent && <p className={styles.hint} style={{ marginTop: 12 }}>After opening the link, <a className={styles.textLink} href="/account">refresh your account</a> to see its status.</p>}
              </> : <p className={styles.hint}>Email delivery is unavailable at the moment. Keep your password and recovery key somewhere safe.</p>}
            </> : <>
              <p className={styles.email}>No email attached</p>
              <p className={styles.hint}>Your account uses a username and password. A saved recovery key is your way back in if you forget your password.</p>
            </>}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="account-key-heading">
          <div className={styles.sectionHeading}><LockKeyhole size={20} aria-hidden="true"/><h2 id="account-key-heading">Recovery key</h2></div>
          <p className={styles.description}>Keep a private key somewhere safe in case you forget your password. You can’t view a key again after leaving the screen where it was created.</p>
          {accountUsername ? <>
            <p className={styles.keyWarning}>Generating a new key immediately replaces any previous key. Save the new one before leaving the next screen.</p>
            <form className={styles.formSpacing} onSubmit={event => submit(event, 'key')} aria-busy={busy === 'key'}>
              <fieldset className={styles.fields} disabled={!!busy || accountChanged}>
                <input type="text" name="username" value={accountUsername} autoComplete="username" readOnly hidden/>
                <AccountPasswordField id="key-password" label="Current password" value={keyPassword} onChange={setKeyPassword} current/>
                <button type="submit" className={styles.secondary}>{busy === 'key' ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Creating your key…</> : <><KeyRound size={16} aria-hidden="true"/>Generate new recovery key</>}</button>
              </fieldset>
            </form>
          </> : <p className={styles.hint}>Choose a username above first, then you can create a recovery key for this account.</p>}
        </section>
      </div>

      <div className={styles.column}>
        <section className={styles.card} aria-labelledby="account-password-heading">
          <div className={styles.sectionHeading}><KeyRound size={20} aria-hidden="true"/><h2 id="account-password-heading">Your password</h2></div>
          <p className={styles.description}>Changing your password also signs out your other devices. You’ll stay signed in here.</p>
          <form onSubmit={event => submit(event, 'password')} aria-busy={busy === 'password'}>
            <fieldset className={styles.fields} disabled={!!busy || accountChanged}>
              <input type="text" name="username" value={accountUsername || user.email || ''} autoComplete="username" readOnly hidden/>
              <AccountPasswordField id="current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} current/>
              <AccountPasswordField id="new-password" label="New password" value={newPassword} onChange={setNewPassword} hint={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters. A few memorable words work well.`}/>
              <AccountPasswordField id="confirm-password" label="Confirm new password" value={confirmation} onChange={setConfirmation}/>
              <button type="submit" className={`${styles.submit} ${styles.formAction}`}>{busy === 'password' ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Changing password…</> : <>Change password<ArrowRight size={16} aria-hidden="true"/></>}</button>
            </fieldset>
          </form>
          <p style={{ marginTop: 16 }}><a className={styles.textLink} href="/forgot-password">Forgot your current password?</a></p>
        </section>

        <section className={styles.card} aria-labelledby="account-devices-heading">
          <div className={styles.sectionHeading}><MonitorSmartphone size={20} aria-hidden="true"/><h2 id="account-devices-heading">Your devices</h2></div>
          <p className={styles.description}>Used a shared computer, or want a fresh start elsewhere? Sign out everywhere except this browser.</p>
          <button type="button" className={`${styles.secondary} ${styles.full}`} disabled={!!busy || accountChanged} onClick={() => void request('devices')}>{busy === 'devices' ? <><LoaderCircle size={16} className={styles.spinner} aria-hidden="true"/>Signing out other devices…</> : <><ShieldCheck size={16} aria-hidden="true"/>Sign out other devices</>}</button>
        </section>
        <section className={styles.card} aria-labelledby="account-safety-heading">
          <div className={styles.sectionHeading}><ShieldCheck size={20} aria-hidden="true"/><h2 id="account-safety-heading">Your reading circle</h2></div>
          <p className={styles.description}>Manage blocked readers and find the community safety tools.</p>
          <a className={styles.textLink} href="/safety">Safety &amp; blocked readers<ArrowRight size={15} aria-hidden="true"/></a>
        </section>
        <FileStorage accountId={user.userId} disabled={!!busy || accountChanged}/>
        <AccountDeletionPanel accountId={user.userId} identity={accountUsername || user.email || user.displayName} disabled={!!busy || accountChanged}
          onBusyChange={active => setBusy(active ? 'delete' : null)}
          onDeleted={filesPending => { clearPasswords(); setIssuedKey(null); setChosenUsername(''); setError(''); setNotice(''); setDeleted({ filesPending }); }}/>
      </div>
    </div>}
    <p className={styles.privacy}><LockKeyhole size={14} aria-hidden="true"/><span>Your account settings are private. Your profile and shared shelves are managed from your reading space. <a href="/privacy">Read about privacy and your data.</a></span></p>
  </AccountFrame>;
}
