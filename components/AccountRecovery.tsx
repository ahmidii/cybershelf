"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Mail } from 'lucide-react';
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth-contract';
import { AUTH_USERNAME_MAX_LENGTH, AUTH_USERNAME_MIN_LENGTH, normalizeUsername, usernameValidationError } from '@/lib/account-identity';
import AccountFrame from './AccountFrame';
import AccountPasswordField from './AccountPasswordField';
import RecoveryKeyPanel from './RecoveryKeyPanel';
import styles from './Account.module.css';

type Props = {
  mode: 'request' | 'reset';
  available: boolean;
  emailAvailable: boolean;
  initialToken?: string;
  invalidLink?: boolean;
};

export default function AccountRecovery({ mode, available, emailAvailable, initialToken = '', invalidLink = false }: Props) {
  const resetting = mode === 'reset';
  const [method, setMethod] = useState<'key' | 'email'>('key');
  const recoveringWithKey = !resetting && method === 'key';
  const [token, setToken] = useState(initialToken);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [issuedKey, setIssuedKey] = useState<{ value: string; username: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [unusableLink, setUnusableLink] = useState(resetting && (invalidLink || !initialToken));
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (complete) successRef.current?.focus(); }, [complete]);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    // Keep the one-time link out of the address bar and subsequent history.
    // A refresh needs the original email link again; it is never persisted.
    if (resetting && window.location.search) window.history.replaceState(window.history.state, '', '/reset-password');
  }, [resetting]);

  function changeMethod(next: 'key' | 'email') {
    if (requestRef.current || issuedKey || complete) return;
    setMethod(next);
    setError('');
    setRecoveryKey('');
    setKeyVisible(false);
    setPassword('');
    setConfirmation('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || requestRef.current || complete || issuedKey || (resetting ? !token || unusableLink : method === 'email' && !emailAvailable)) return;
    setError('');
    if (recoveringWithKey) {
      const validation = usernameValidationError(username);
      if (validation) { setError(validation); return; }
      if (!recoveryKey.trim()) { setError('Enter the recovery key you saved when it was created.'); return; }
    }
    if ((resetting || recoveringWithKey) && password !== confirmation) {
      setError('Your new passwords don’t match. Please enter the same password twice.');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setSubmitting(true);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(recoveringWithKey ? '/api/account/recover' : `/api/auth/${resetting ? 'reset-password' : 'request-password-reset'}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recoveringWithKey ? { username: normalizeUsername(username), recoveryKey: recoveryKey.trim(), newPassword: password }
          : resetting ? { token, newPassword: password } : { email: email.trim(), redirectTo: `${window.location.origin}/reset-password` }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as { code?: string; message?: string; recoveryKey?: string };
      if (!response.ok) {
        if (response.status === 429) setError('A few too many attempts. Please wait a minute, then try again.');
        else if (resetting && ['INVALID_TOKEN', 'TOKEN_EXPIRED', 'TOKEN_NOT_FOUND'].includes(data.code ?? '')) {
          setToken('');
          setPassword('');
          setConfirmation('');
          setUnusableLink(true);
          setError('This reset link has expired or already been used. Request a new link to try again.');
        } else if (data.code === 'PASSWORD_POLICY') setError(typeof data.message === 'string' && data.message.trim() && data.message.length <= 240 ? data.message : `Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
        else if (data.code === 'PASSWORD_TOO_SHORT') setError(`Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
        else if (data.code === 'PASSWORD_TOO_LONG') setError('Please choose a shorter password.');
        else if (data.code === 'INVALID_EMAIL') setError('Please enter a complete email address.');
        else if (recoveringWithKey && (data.code === 'INVALID_RECOVERY_KEY' || data.code === 'INVALID_USERNAME' || response.status === 401)) setError('The username and recovery key didn’t match. Check your saved username and use your most recent key.');
        else setError(resetting || recoveringWithKey ? 'We couldn’t change your password just now. Please try again.' : 'We couldn’t request a reset link just now. Please try again in a moment.');
        return;
      }
      setToken('');
      setRecoveryKey('');
      setKeyVisible(false);
      setPassword('');
      setConfirmation('');
      if (recoveringWithKey) {
        if (typeof data.recoveryKey !== 'string' || !data.recoveryKey || data.recoveryKey.length > 512) {
          setError('Your password may have changed, but the replacement key could not be displayed. Try signing in with your new password, then generate a new recovery key in Account & security.');
          return;
        }
        setIssuedKey({ value: data.recoveryKey, username: normalizeUsername(username) });
      } else setComplete(true);
    } catch {
      setError(recoveringWithKey
        ? 'We couldn’t confirm the result. Your password may have changed and your old key may have been used. Try signing in with your new password; if it works, generate a new recovery key in Account & security.'
        : controller.signal.aborted
          ? resetting ? 'That took longer than expected. If the link no longer works, try signing in with your new password.' : 'That took longer than expected. Check your inbox before requesting another link.'
          : 'We couldn’t reach cybershelf. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
      setSubmitting(false);
    }
  }

  return <AccountFrame>
    <section className={styles.card} aria-labelledby="recovery-heading">
      <div className={styles.icon} aria-hidden="true">{complete || issuedKey ? <Check size={22}/> : resetting || recoveringWithKey ? <KeyRound size={22}/> : <Mail size={22}/>}</div>
      <p className={styles.eyebrow}>YOUR READING CORNER</p>
      <h1 id="recovery-heading">{issuedKey ? 'A fresh start.' : complete ? resetting ? 'A fresh start.' : 'Check your inbox.' : resetting ? 'A new key to your shelf.' : 'Let’s get you back in.'}</h1>
      {!complete && !issuedKey && <p className={styles.description}>{resetting ? 'Choose a new password to get back to your books.' : 'Use your saved recovery key, or request an email link if your account already has an email address.'}</p>}

      {!resetting && !complete && !issuedKey && <div className={styles.recoveryMethods} role="group" aria-label="Recovery method">
        <button type="button" className={method === 'key' ? styles.chosenMethod : ''} aria-pressed={method === 'key'} disabled={submitting} onClick={() => changeMethod('key')}><KeyRound size={15} aria-hidden="true"/>Recovery key</button>
        <button type="button" className={method === 'email' ? styles.chosenMethod : ''} aria-pressed={method === 'email'} disabled={submitting} onClick={() => changeMethod('email')}><Mail size={15} aria-hidden="true"/>Email link</button>
      </div>}
      {error && <div className={styles.error} role="alert" ref={errorRef} tabIndex={-1}>{error}</div>}
      {issuedKey ? <>
        <div className={styles.success} role="status"><strong>Your password has been changed.</strong><p>Your sessions have been signed out. Save your replacement key, then sign in with your new password.</p></div>
        <RecoveryKeyPanel recoveryKey={issuedKey.value} username={issuedKey.username} replacing continueLabel="I saved my key — go to sign in" onDone={() => { setIssuedKey(null); window.location.replace('/signin'); }}/>
      </> : complete ? <div ref={successRef} tabIndex={-1}>
        <div className={styles.success} role="status">{resetting
          ? <><strong>Your password has been changed.</strong><p>You’ve been signed out on your devices. Sign in with your new password to pick up where you left off.</p></>
          : <><strong>If an account uses this email, a reset link is on its way.</strong><p>Give it a few minutes and check your spam folder, too. The link expires in one hour.</p></>}
        </div>
        {resetting ? <a className={`${styles.submit} ${styles.full}`} href="/signin">Sign in to your account<ArrowRight size={16} aria-hidden="true"/></a>
          : <p className={styles.hint}>For your privacy, this message is the same whether or not an account exists. You can request another link after a minute if you need one.</p>}
      </div> : !available || (!resetting && method === 'email' && !emailAvailable) ? <div className={styles.notice} role="status">
        <p>{!available ? 'Account sign-in is being set up. Please try again later.' : 'Email delivery is unavailable at the moment. You can use a saved recovery key, or sign in normally if you know your password.'}</p>
      </div> : resetting && unusableLink ? <div className={styles.notice}>
        <p>Open the most recent password reset link in your email. Each link can only be used once.</p>
        <a className={styles.textLink} href="/forgot-password">Choose a recovery option<ArrowRight size={14} aria-hidden="true"/></a>
      </div> : <form onSubmit={submit} aria-busy={submitting}>
        <fieldset className={styles.fields} disabled={submitting}>
          {recoveringWithKey ? <>
            <div className={styles.field}>
              <label htmlFor="recovery-username">Username</label>
              <input id="recovery-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={AUTH_USERNAME_MIN_LENGTH} maxLength={AUTH_USERNAME_MAX_LENGTH} value={username} onChange={event => setUsername(event.target.value)}/>
            </div>
            <div className={styles.field}>
              <label htmlFor="recovery-key">Saved recovery key</label>
              <div className={styles.passwordInput}>
                <input id="recovery-key" name="recovery-key" type={keyVisible ? 'text' : 'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={512} value={recoveryKey} onChange={event => setRecoveryKey(event.target.value)} aria-describedby="recovery-key-hint"/>
                <button type="button" className={styles.reveal} aria-controls="recovery-key" aria-pressed={keyVisible} aria-label={keyVisible ? 'Hide recovery key' : 'Show recovery key'} onClick={() => setKeyVisible(value => !value)}>{keyVisible ? <EyeOff size={17} aria-hidden="true"/> : <Eye size={17} aria-hidden="true"/>}</button>
              </div>
              <p className={styles.hint} id="recovery-key-hint">Use the most recent key you saved. A successful recovery replaces this key and signs out your devices.</p>
            </div>
          </> : !resetting ? <div className={styles.field}>
            <label htmlFor="recovery-email">Email address</label>
            <input id="recovery-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={AUTH_EMAIL_MAX_LENGTH} placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/>
            <p className={styles.hint}>This option is for existing accounts with an email address. New username-only accounts use their saved recovery key.</p>
          </div> : null}
          {(resetting || recoveringWithKey) && <>
            <AccountPasswordField id="reset-password" label="New password" value={password} onChange={setPassword} hint={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters. A few memorable words work well.`}/>
            <AccountPasswordField id="reset-confirmation" label="Confirm new password" value={confirmation} onChange={setConfirmation}/>
          </>}
          <button type="submit" className={`${styles.submit} ${styles.formAction}`}>{submitting ? <><LoaderCircle className={styles.spinner} size={16} aria-hidden="true"/>{resetting || recoveringWithKey ? 'Changing password…' : 'Requesting your link…'}</> : <>{resetting || recoveringWithKey ? 'Save new password' : 'Send reset link'}<ArrowRight size={16} aria-hidden="true"/></>}</button>
          {recoveringWithKey && <p className={styles.hint}>If your account has no email and you lose both your password and recovery key, we can’t restore access.</p>}
        </fieldset>
      </form>}
      {!issuedKey && !(complete && resetting) && <p className={styles.backToSignIn}><a className={styles.textLink} href="/signin"><ArrowLeft size={14} aria-hidden="true"/>Back to sign in</a></p>}
    </section>
    <p className={styles.privacy}><LockKeyhole size={14} aria-hidden="true"/><span>Keep passwords and recovery keys private. <a href="/privacy">Read about privacy and your data.</a></span></p>
  </AccountFrame>;
}
