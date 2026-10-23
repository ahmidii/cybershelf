'use client';
import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { displayReadingProgress } from '@/lib/reading-progress';
import styles from './Feed.module.css';

export interface SpoilerTextProps {
  progress: number; readerProgress: number; unread: boolean; body: string; defaultHide?: boolean;
}
/** Hidden prose is not mounted: keyboard users and screen readers receive the
 * same spoiler protection as sighted readers. Reveal applies to this card only. */
export default function SpoilerText({ progress, readerProgress, unread, body, defaultHide = true }: SpoilerTextProps) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const key = `${progress}\0${readerProgress}\0${unread}\0${body}`;
  const guarded = defaultHide && (unread || progress > readerProgress), hidden = guarded && revealedKey !== key;
  if (!body) return null;
  return <div className={styles.spoiler}>
    {hidden ? <div className={styles.spoilerGuard}>
      <ShieldCheck size={19} aria-hidden="true" /><div><strong>{unread ? 'Save this for later' : 'A little ahead of your bookmark'}</strong>
        <p>{unread ? 'This book is unread or not in your library.' : `This update reaches ${displayReadingProgress(progress)}%. You’re at ${displayReadingProgress(readerProgress)}%.`}</p></div>
      <button type="button" className="button secondary small" onClick={() => setRevealedKey(key)} aria-expanded="false"><Eye size={14} />Reveal</button>
    </div> : <>
      <p className={styles.body}>{body}</p>
      {guarded ? <button type="button" className={styles.hideAgain} onClick={() => setRevealedKey(null)} aria-expanded="true"><EyeOff size={13} />Hide again</button> : null}
    </>}
  </div>;
}
