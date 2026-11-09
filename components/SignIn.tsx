'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Full navigations reload the account context and honor the unsaved-recovery-key warning. */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  safeRelativeReturnPath,
} from '@/lib/auth-contract';
import { AUTH_USERNAME_MIN_LENGTH, AUTH_USERNAME_MAX_LENGTH, normalizeUsername, usernameValidationError } from '@/lib/account-identity';
import RecoveryKeyPanel from './RecoveryKeyPanel';
import DecorArt from './DecorArt';
import styles from './SignIn.module.css';
import BrandMark from './BrandMark';
import BrandWordmark from './BrandWordmark';

type Mode = 'sign-in' | 'sign-up';
type AuthError = { code?: string; message?: string };

function errorMessage(status: number, error: AuthError, mode: Mode): string {
  if (status === 429) return 'A few too many attempts. Please wait a minute, then try again.';
  if (error.code === 'AUTH_NOT_CONFIGURED') return 'Account sign-in is not available yet. You can keep browsing and try again later.';
  if (error.code === 'ACCOUNT_CREATED_RECOVERY_UNAVAILABLE') return 'Your account was created, but its recovery key could not be saved. Sign in with your username and password to generate a key in Account & security.';
  if (status >= 500) return 'We couldn’t open your account just now. Please try again in a moment.';
  switch (error.code) {
    case 'INVALID_EMAIL':
      return 'Please enter a complete email address.';
    case 'PASSWORD_TOO_SHORT':
      return `Choose a password with at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
    case 'PASSWORD_TOO_LONG':
      return `Your password must be ${AUTH_PASSWORD_MAX_LENGTH} characters or fewer.`;
    case 'PASSWORD_POLICY':
      return typeof error.message === 'string' && error.message.trim() && error.message.length <= 240
        ? error.message : `Choose a password with ${AUTH_PASSWORD_MIN_LENGTH}–${AUTH_PASSWORD_MAX_LENGTH} characters.`;
    case 'INVALID_USERNAME':
      return 'Use a username of 3–30 letters, numbers, and underscores, beginning and ending with a letter or number.';
    case 'USERNAME_TAKEN':
    case 'USERNAME_IS_ALREADY_TAKEN':
      return 'That username is already taken. Try a different one, or sign in if it is yours.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account may already use this email. Try signing in instead.';
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_USERNAME_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return 'That username or email and password didn’t match. Check both and try again.';
    case 'INVALID_ORIGIN':
    case 'INVALID_ORIGIN_HEADER':
      return 'This sign-in page needs to be refreshed. Reload the page and try again.';
    default:
      return mode === 'sign-up'
        ? 'Your account couldn’t be created. Check your details and try again.'
        : 'We couldn’t sign you in. Check your username or email and password, then try again.';
  }
}

export default function SignIn({ returnTo, available, reauthenticate = false, initialIdentifier = '' }: {
  returnTo: string;
  available: boolean;
  emailAvailable?: boolean;
  reauthenticate?: boolean;
  initialIdentifier?: string;
}) {
  const destination = safeRelativeReturnPath(returnTo);
  const [mode, setMode] = useState<Mode>('sign-in');
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsRecoveryKey, setNeedsRecoveryKey] = useState(false);
  const [issuedKey, setIssuedKey] = useState<{ value: string; username: string; accountId: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const creating = mode === 'sign-up';

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => () => requestRef.current?.abort(), []);

  function changeMode(next: Mode) {
    if (submitting || issuedKey || next === mode) return;
    setMode(next);
    setError('');
    setNeedsRecoveryKey(false);
    setPassword('');
    setShowPassword(false);
    if (next === 'sign-up' && identifier.includes('@')) setIdentifier('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || requestRef.current || issuedKey) return;
    setError('');
    const cleanIdentifier = identifier.trim();
    if (creating) { const invalid = usernameValidationError(cleanIdentifier); if (invalid) { setError(invalid); return; } }
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
      const withEmail = !creating && cleanIdentifier.includes('@');
      const response = await fetch(`/api/auth/${creating ? 'sign-up' : 'sign-in'}/${withEmail ? 'email' : 'username'}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creating
          ? { username: normalizeUsername(cleanIdentifier), password }
          : { ...(withEmail ? { email: cleanIdentifier } : { username: normalizeUsername(cleanIdentifier) }), password, rememberMe: true }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as AuthError;
        if (creating && result.code === 'ACCOUNT_CREATED_RECOVERY_UNAVAILABLE') {
          setMode('sign-in'); setPassword(''); setShowPassword(false); setNeedsRecoveryKey(true);
        }
        setError(errorMessage(response.status, result, mode));
        return;
      }
      if (creating) {
        const result = await response.json() as { recoveryKey?: string; user?: { id?: string; username?: string } };
        setPassword(''); setShowPassword(false);
        if (typeof result.recoveryKey !== 'string' || !result.recoveryKey || result.recoveryKey.length > 512 || !result.user?.id) {
          setMode('sign-in');
          setNeedsRecoveryKey(true);
          setError('Your account was created, but its recovery key could not be displayed. Sign in with your password, then get a new key from Account & security.');
          return;
        }
        setIssuedKey({ value: result.recoveryKey, username: result.user.username || normalizeUsername(cleanIdentifier), accountId: result.user.id });
        return;
      }
      leaving = true;
      // A full navigation reloads the server session and the library together.
      window.location.replace(needsRecoveryKey ? '/account' : destination);
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
      <a className={styles.brand} href="/" aria-label="cybershelf home"><BrandWordmark/></a>
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
        {!reauthenticate && !issuedKey && <div className={styles.modeSwitch} role="group" aria-label="Account action">
          <button type="button" aria-pressed={!creating} disabled={submitting} className={!creating ? styles.selectedMode : undefined} onClick={() => changeMode('sign-in')}>Sign in</button>
          <button type="button" aria-pressed={creating} disabled={submitting} className={creating ? styles.selectedMode : undefined} onClick={() => changeMode('sign-up')}>Create account</button>
        </div>}
        <div className={styles.cardHeading}>
          <p className={styles.eyebrow}>YOUR READING CORNER</p>
          <h1 id="auth-heading">{issuedKey ? 'Your reading corner is ready.' : creating ? 'Make yourself at home.' : reauthenticate ? 'One quick check.' : 'Welcome back.'}</h1>
          <p>{issuedKey ? 'One small step before you settle in: keep a way back to your account.' : creating ? 'Just a username and a password. No email or real name required.' : reauthenticate ? 'Sign in again before changing your account settings.' : 'Your library, your shelves, and your next chapter are waiting.'}</p>
        </div>

        {!available && <div className={styles.setupNotice} role="status">
          <strong>We’re getting the keys ready.</strong>
          <p>Account sign-in is being set up. You can explore the shelves and start a draft in this browser in the meantime.</p>
          <a href="/">Explore cybershelf <ArrowRight size={14} aria-hidden="true"/></a>
        </div>}

        {issuedKey ? <RecoveryKeyPanel recoveryKey={issuedKey.value} username={issuedKey.username} accountId={issuedKey.accountId} continueLabel="Open my reading corner" onDone={() => { setIssuedKey(null); window.location.replace(destination); }} onAccountChanged={() => { setIssuedKey(null); setMode('sign-in'); setError('Your signed-in account changed. Sign in with your username and password, then get a new recovery key from Account & security.'); }}/> : <form onSubmit={submit} aria-busy={submitting} aria-describedby={error ? 'auth-error' : undefined}>
          {error && <div id="auth-error" ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>{error}</div>}
          <fieldset className={styles.fields} disabled={!available || submitting}>
            <div className={styles.field}>
              <label htmlFor="auth-identifier">{creating ? 'Username' : 'Username or email'}</label>
              <input id="auth-identifier" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={creating ? AUTH_USERNAME_MIN_LENGTH : undefined} maxLength={creating ? AUTH_USERNAME_MAX_LENGTH : AUTH_EMAIL_MAX_LENGTH} value={identifier} onChange={event => setIdentifier(event.target.value)} aria-describedby={creating ? 'auth-username-hint' : undefined} placeholder={creating ? 'your_reading_corner' : 'Your username or existing email'}/>
              {creating && <p id="auth-username-hint" className={styles.fieldHint}>3–30 letters, numbers, or underscores; start and end with a letter or number. Your display name starts here and can be changed in your profile.</p>}
            </div>
            <div className={styles.field}>
              <label htmlFor="auth-password">Password</label>
              <div className={styles.passwordInput}>
                <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? AUTH_PASSWORD_MIN_LENGTH : undefined} maxLength={AUTH_PASSWORD_MAX_LENGTH} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={creating ? 'auth-password-hint' : undefined}/>
                <button type="button" className={styles.reveal} onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button>
              </div>
              {creating && <p id="auth-password-hint" className={styles.fieldHint}>At least {AUTH_PASSWORD_MIN_LENGTH} characters. A few memorable words work well.</p>}
            </div>
            {!creating && <a className={styles.forgotLink} href="/forgot-password">Forgot your password?</a>}
            {creating && <p className={styles.recoveryNote}>After signup, save your recovery key. It is your way back if you forget your password. Losing both means we cannot restore access to an account without email.</p>}
            <button className={styles.submit} type="submit">
              {submitting ? <><LoaderCircle size={17} className={styles.spinner} aria-hidden="true"/>{creating ? 'Creating your account…' : 'Signing you in…'}</> : <>{creating ? 'Create my account' : 'Sign in'}<ArrowRight size={17} aria-hidden="true"/></>}
            </button>
          </fieldset>
          <p className="sr-only" role="status">{submitting ? (creating ? 'Creating your account. Please wait.' : 'Signing you in. Please wait.') : ''}</p>
        </form>}
        {!issuedKey && <p className={styles.browse}>Just looking around? <a href={destination}>Continue browsing</a></p>}
        <p className={styles.privacyLink}><a href="/privacy">Privacy and your data</a></p>
      </section>
    </main>

    <footer className={styles.footer}><span>cybershelf</span><span>A little space for your books. <a href="/privacy">Privacy</a></span></footer>
  </div>;
}
