'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, KeyRound, LoaderCircle, Mail } from 'lucide-react';
import { AUTH_EMAIL_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth-contract';
import AccountFrame from './AccountFrame';
import AccountPasswordField from './AccountPasswordField';
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
  const [token, setToken] = useState(initialToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || requestRef.current || complete || (resetting ? !token || unusableLink : !emailAvailable)) return;
    setError('');
    if (resetting && password !== confirmation) {
      setError('Your new passwords don’t match. Please enter the same password twice.');
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setSubmitting(true);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`/api/auth/${resetting ? 'reset-password' : 'request-password-reset'}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetting ? { token, newPassword: password } : { email: email.trim(), redirectTo: `${window.location.origin}/reset-password` }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { code?: string };
        if (response.status === 429) setError('A few too many attempts. Please wait a minute, then try again.');
        else if (resetting && ['INVALID_TOKEN', 'TOKEN_EXPIRED', 'TOKEN_NOT_FOUND'].includes(data.code ?? '')) {
          setToken('');
          setPassword('');
          setConfirmation('');
          setUnusableLink(true);
          setError('This reset link has expired or already been used. Request a new link to try again.');
        } else if (data.code === 'PASSWORD_TOO_SHORT') setError(`Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
        else if (data.code === 'PASSWORD_TOO_LONG') setError('Please choose a shorter password.');
        else if (data.code === 'INVALID_EMAIL') setError('Please enter a complete email address.');
        else setError(resetting ? 'We couldn’t change your password just now. Please try again.' : 'We couldn’t request a reset link just now. Please try again in a moment.');
        return;
      }
      setToken('');
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch {
      setError(controller.signal.aborted
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
      <div className={styles.icon} aria-hidden="true">{complete ? <Check size={22}/> : resetting ? <KeyRound size={22}/> : <Mail size={22}/>}</div>
      <p className={styles.eyebrow}>YOUR READING CORNER</p>
      <h1 id="recovery-heading">{complete ? resetting ? 'A fresh start.' : 'Check your inbox.' : resetting ? 'A new key to your shelf.' : 'Let’s get you back in.'}</h1>
      {!complete && <p className={styles.description}>{resetting ? 'Choose a new password to get back to your books.' : 'Enter the email you use for cybershelf and we’ll send you a password reset link.'}</p>}

      {error && <div className={styles.error} role="alert" ref={errorRef} tabIndex={-1}>{error}</div>}
      {complete ? <div ref={successRef} tabIndex={-1}>
        <div className={styles.success} role="status">{resetting
          ? <><strong>Your password has been changed.</strong><p>You’ve been signed out on your devices. Sign in with your new password to pick up where you left off.</p></>
          : <><strong>If an account uses this email, a reset link is on its way.</strong><p>Give it a few minutes and check your spam folder, too. The link expires in one hour.</p></>}
        </div>
        {resetting ? <a className={`${styles.submit} ${styles.full}`} href="/signin">Sign in to your account<ArrowRight size={16} aria-hidden="true"/></a>
          : <p className={styles.hint}>For your privacy, this message is the same whether or not an account exists. You can request another link after a minute if you need one.</p>}
      </div> : !available || (!resetting && !emailAvailable) ? <div className={styles.notice} role="status">
        <p>{!available ? 'Account sign-in is being set up. Please try again later.' : 'Email recovery has not been enabled for this site yet. If you know your password, you can still sign in normally.'}</p>
      </div> : resetting && unusableLink ? <div className={styles.notice}>
        <p>Open the most recent password reset link in your email. Each link can only be used once.</p>
        {emailAvailable && <a className={styles.textLink} href="/forgot-password">Request a new reset link<ArrowRight size={14} aria-hidden="true"/></a>}
      </div> : <form onSubmit={submit} aria-busy={submitting}>
        <fieldset className={styles.fields} disabled={submitting}>
          {resetting ? <>
            <AccountPasswordField id="reset-password" label="New password" value={password} onChange={setPassword} hint={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters. A few memorable words work well.`}/>
            <AccountPasswordField id="reset-confirmation" label="Confirm new password" value={confirmation} onChange={setConfirmation}/>
          </> : <div className={styles.field}>
            <label htmlFor="recovery-email">Email address</label>
            <input id="recovery-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={AUTH_EMAIL_MAX_LENGTH} placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/>
          </div>}
          <button type="submit" className={`${styles.submit} ${styles.formAction}`}>{submitting ? <><LoaderCircle className={styles.spinner} size={16} aria-hidden="true"/>{resetting ? 'Changing password…' : 'Requesting your link…'}</> : <>{resetting ? 'Save new password' : 'Send reset link'}<ArrowRight size={16} aria-hidden="true"/></>}</button>
        </fieldset>
      </form>}
      {!(complete && resetting) && <p className={styles.backToSignIn}><a className={styles.textLink} href="/signin"><ArrowLeft size={14} aria-hidden="true"/>Back to sign in</a></p>}
    </section>
  </AccountFrame>;
}
