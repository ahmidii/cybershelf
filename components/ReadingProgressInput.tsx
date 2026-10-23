'use client';

import { useId } from 'react';
import type { Book } from '@/lib/types';
import { bookReadingProgress, displayReadingProgress, MAX_BOOK_PAGES, readingInputPages, resolveReadingPosition, type ReadingPositionInput } from '@/lib/reading-progress';
import styles from './ReadingProgressInput.module.css';

export default function ReadingProgressInput({ book, value, onChange, onBlur, onEditPageCount, disabled, unchangedBookmark = false, labelPrefix = '' }: {
  book: Pick<Book, 'pages' | 'progress' | 'status'>;
  value: ReadingPositionInput;
  onChange: (patch: Partial<ReadingPositionInput>, field: 'marker' | 'totalPages' | 'mode') => void;
  onBlur?: () => void;
  onEditPageCount?: () => void;
  disabled?: boolean;
  unchangedBookmark?: boolean;
  labelPrefix?: string;
}) {
  const helpId = useId();
  const pages = readingInputPages(book, value.totalPages);
  let calculated: number | undefined;
  try { calculated = resolveReadingPosition(book, value).progress; } catch { /* Keep incomplete numeric input editable. */ }
  const switchMode = () => {
    const mode = value.mode === 'page' ? 'percent' : 'page';
    const progress = unchangedBookmark ? bookReadingProgress(book) : calculated ?? bookReadingProgress(book);
    const marker = mode === 'page' ? pages ? String(Math.floor(pages * progress / 100 + 1e-9)) : '' : String(progress);
    onChange({ mode, marker }, 'mode');
  };
  return <div className={styles.progressInput}>
    <div className={styles.fields}>
      <label className={styles.marker}><span>{value.mode === 'page' ? 'Page reached' : 'Percentage read'}</span><div>
        <input aria-label={`${labelPrefix}${value.mode === 'page' ? 'Page reached' : 'Percentage read'}`} aria-describedby={helpId} type="number" inputMode={value.mode === 'page' ? 'numeric' : 'decimal'} min={0} max={value.mode === 'page' ? pages ?? MAX_BOOK_PAGES : 100} step={value.mode === 'page' ? 1 : 'any'} value={value.marker} placeholder="0" disabled={disabled} onChange={event => onChange({ marker: event.target.value }, 'marker')} onBlur={onBlur}/>
        {value.mode === 'page' && book.pages ? <span className={styles.unit}>of {book.pages.toLocaleString()}</span> : value.mode === 'percent' ? <span className={styles.unit}>%</span> : null}
      </div></label>
      {value.mode === 'page' && !book.pages ? <label className={styles.total}><span>Total pages in this edition</span><input aria-label={`${labelPrefix}Total pages in this edition`} aria-describedby={helpId} type="number" inputMode="numeric" min={1} max={MAX_BOOK_PAGES} step={1} value={value.totalPages ?? ''} placeholder="Add once" disabled={disabled} onChange={event => onChange({ totalPages: event.target.value }, 'totalPages')} onBlur={onBlur}/></label> : null}
      {value.mode === 'page' && calculated !== undefined ? <output className={styles.calculated} aria-live="polite"><strong>{displayReadingProgress(calculated)}%</strong><span>calculated for you</span></output> : null}
    </div>
    <p id={helpId} className={styles.help}>{value.mode === 'percent' ? 'Use the percentage shown by your reading app.' : book.pages ? 'Enter your page. Your progress is calculated from this edition’s page count.' : 'Add the total pages once; next time, just enter your page.'}</p>
    <div className={styles.actions}>
      {value.mode === 'page' && book.pages && onEditPageCount ? <button type="button" onClick={onEditPageCount} disabled={disabled}>Edit page count</button> : null}
      <button type="button" onClick={switchMode} disabled={disabled}>{value.mode === 'page' ? 'Use percentage instead' : 'Use page number'}</button>
    </div>
  </div>;
}
