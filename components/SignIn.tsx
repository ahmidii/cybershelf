'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_NAME_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  safeRelativeReturnPath,
} from '@/lib/auth-contract';
import DecorArt from './DecorArt';
import styles from './SignIn.module.css';
import BrandMark from './BrandMark';

type Mode = 'sign-in' | 'sign-up';
type AuthError = { code?: string; message?: string };

function errorMessage(status: number, error: AuthError, mode: Mode): string {
  if (status === 429) return 'A few too many attempts. Please wait a minute, then try again.';
  if (error.code === 'AUTH_NOT_CONFIGURED') return 'Account sign-in is not available yet. You can keep browsing and try again later.';
  if (status >= 500) return 'We couldn’t open your account just now. Please try again in a moment.';
  switch (error.code) {
    case 'INVALID_EMAIL':
      return 'Please enter a complete email address.';
    case 'PASSWORD_TOO_SHORT':
      return `Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
    case 'PASSWORD_TOO_LONG':
      return `Your password must be ${AUTH_PASSWORD_MAX_LENGTH} characters or fewer.`;
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account may already use this email. Try signing in instead.';
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return 'That email and password didn’t match. Check both and try again.';
    case 'INVALID_ORIGIN':
    case 'INVALID_ORIGIN_HEADER':
      return 'This sign-in page needs to be refreshed. Reload the page and try again.';
    default:
      return mode === 'sign-up'
        ? 'Your account couldn’t be created. Check your details and try again.'
        : 'We couldn’t sign you in. Check your email and password, then try again.';
  }
}

export default function SignIn({ returnTo, available }: { returnTo: string; available: boolean }) {
  const destination = safeRelativeReturnPath(returnTo);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const creating = mode === 'sign-up';

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => () => requestRef.current?.abort(), []);

  function changeMode(next: Mode) {
    if (submitting || next === mode) return;
    setMode(next);
    setError('');
    setPassword('');
    setShowPassword(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || requestRef.current) return;
    setError('');
    const cleanEmail = email.trim();
    const cleanName = name.trim();
    if (creating && !cleanName) {
      setError('Add a display name for your reading corner. A pen name is welcome, too.');
      return;
    }
    if (creating && password.length < AUTH_PASSWORD_MIN_LENGTH) {
      setError(`Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setSubmitting(true);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    let leaving = false;
    try {
      const response = await fetch(`/api/auth/${creating ? 'sign-up' : 'sign-in'}/email`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creating
          ? { name: cleanName, email: cleanEmail, password }
          : { email: cleanEmail, password, rememberMe: true }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as AuthError;
        setError(errorMessage(response.status, result, mode));
        return;
      }
      leaving = true;
      // A full navigation reloads the server session and the library together.
      window.location.replace(destination);
    } catch {
      setError(controller.signal.aborted
        ? creating
          ? 'That took longer than expected. Your account may have been created; try signing in with the same details.'
          : 'That took longer than expected. Please try signing in again.'
        : 'We couldn’t reach cybershelf. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
      if (!leaving) setSubmitting(false);
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="cybershelf home"><BrandMark/>cybershelf</a>
      <a className={styles.back} href={destination}><ArrowLeft size={14} aria-hidden="true"/>Back to shelves</a>
    </header>

    <main className={styles.main}>
      <section className={styles.intro} aria-label="A home for your reading life">
        <p className={styles.eyebrow}>A HOME FOR YOUR READING LIFE</p>
        <h2>Your books.<br/>Your little world.</h2>
        <p className={styles.introText}>A place for the stories you love, the ones you’ll find next, and a shelf that feels like you.</p>
        <div className={styles.illustration} aria-hidden="true">
          <div className={styles.shelfObjects}>
            <div className={styles.books}>
              <span className={styles.bookOne}><i/>stories<i/></span>
              <span className={styles.bookTwo}><i/>somewhere<i/></span>
              <span className={styles.bookThree}><i/>in between<i/></span>
              <span className={styles.bookFour}><i/>the pages<i/></span>
            </div>
            <DecorArt kind="plant" className={styles.plant}/>
            <BrandMark className={styles.bookend}/>
          </div>
          <div className={styles.shelfBoard}/>
          <span className={styles.shelfCaption}>collected, arranged, yours.</span>
        </div>
        <p className={styles.privacy}>Your library stays private.<br/>You choose which shelves to share.</p>
      </section>

      <section className={styles.card} aria-labelledby="auth-heading">
        <div className={styles.modeSwitch} role="group" aria-label="Account action">
          <button type="button" aria-pressed={!creating} disabled={submitting} className={!creating ? styles.selectedMode : undefined} onClick={() => changeMode('sign-in')}>Sign in</button>
          <button type="button" aria-pressed={creating} disabled={submitting} className={creating ? styles.selectedMode : undefined} onClick={() => changeMode('sign-up')}>Create account</button>
        </div>
        <div className={styles.cardHeading}>
          <p className={styles.eyebrow}>YOUR READING CORNER</p>
          <h1 id="auth-heading">{creating ? 'Make yourself at home.' : 'Welcome back.'}</h1>
          <p>{creating ? 'Save your books, arrange your shelves, and make a little space of your own.' : 'Your library, your shelves, and your next chapter are waiting.'}</p>
        </div>

        {!available && <div className={styles.setupNotice} role="status">
          <strong>We’re getting the keys ready.</strong>
          <p>Account sign-in is being set up. You can explore the shelves and start a draft in this browser in the meantime.</p>
          <a href="/">Explore cybershelf <ArrowRight size={14} aria-hidden="true"/></a>
        </div>}

        <form onSubmit={submit} aria-busy={submitting} aria-describedby={error ? 'auth-error' : undefined}>
          {error && <div id="auth-error" ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>{error}</div>}
          <fieldset className={styles.fields} disabled={!available || submitting}>
            {creating && <div className={styles.field}>
              <label htmlFor="auth-name">Display name</label>
              <input id="auth-name" name="name" type="text" autoComplete="nickname" required maxLength={AUTH_NAME_MAX_LENGTH} value={name} onChange={event => setName(event.target.value)} aria-describedby="auth-name-hint" placeholder="Your name or pen name"/>
              <p id="auth-name-hint" className={styles.fieldHint}>This name appears on shelves you share.</p>
            </div>}
            <div className={styles.field}>
              <label htmlFor="auth-email">Email address</label>
              <input id="auth-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={AUTH_EMAIL_MAX_LENGTH} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/>
            </div>
            <div className={styles.field}>
              <label htmlFor="auth-password">Password</label>
              <div className={styles.passwordInput}>
                <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? AUTH_PASSWORD_MIN_LENGTH : undefined} maxLength={AUTH_PASSWORD_MAX_LENGTH} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={creating ? 'auth-password-hint' : undefined}/>
                <button type="button" className={styles.reveal} onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button>
              </div>
              {creating && <p id="auth-password-hint" className={styles.fieldHint}>At least {AUTH_PASSWORD_MIN_LENGTH} characters. A few memorable words work well.</p>}
            </div>
            {creating && <p className={styles.recoveryNote}>Keep your password somewhere safe. Password reset is not available in this first edition.</p>}
            <button className={styles.submit} type="submit">
              {submitting ? <><LoaderCircle size={17} className={styles.spinner} aria-hidden="true"/>{creating ? 'Creating your account…' : 'Signing you in…'}</> : <>{creating ? 'Create my account' : 'Sign in'}<ArrowRight size={17} aria-hidden="true"/></>}
            </button>
          </fieldset>
          <p className="sr-only" role="status">{submitting ? (creating ? 'Creating your account. Please wait.' : 'Signing you in. Please wait.') : ''}</p>
        </form>
        <p className={styles.browse}>Just looking around? <a href={destination}>Continue browsing</a></p>
      </section>
    </main>

    <footer className={styles.footer}><span>cybershelf · first edition</span><span>A little space for your books.</span></footer>
  </div>;
}
