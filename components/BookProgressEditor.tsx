'use client';

import { useEffect, useRef, useState } from 'react';
import type { Book } from '@/lib/types';
import { bookReadingProgress, currentReadingPage, readingInputPages, readingPositionPatch, resolveReadingPosition, type ReadingPositionInput } from '@/lib/reading-progress';
import ReadingProgressInput from './ReadingProgressInput';

export default function BookProgressEditor({ book, onChange, onEditPageCount }: { book: Book; onChange: (book: Book) => void; onEditPageCount: () => void }) {
  const [draft, setDraft] = useState<ReadingPositionInput>({ mode: 'page', marker: String(currentReadingPage(book) ?? ''), totalPages: '' });
  const [error, setError] = useState('');
  const dirty = useRef(false), current = useRef(book); current.current = book;
  useEffect(() => {
    if (!dirty.current) setDraft(previous => ({ ...previous, marker: String(previous.mode === 'page' ? currentReadingPage(book) ?? '' : bookReadingProgress(book)) }));
  }, [book.pages, book.progress, book.currentPage, book.status]);
  const commit = () => {
    if (!dirty.current) return;
    // Let the reader complete the one-time edition total without an early error
    // when moving from the page field to the total-pages field.
    if (draft.mode === 'page' && !readingInputPages(current.current, draft.totalPages) && !draft.totalPages?.trim()) return;
    try {
      const position = resolveReadingPosition(current.current, draft);
      onChange({ ...current.current, ...readingPositionPatch(current.current, position) });
      dirty.current = false; setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Check your page number.'); }
  };
  return <form onSubmit={event => { event.preventDefault(); commit(); }}>
    <ReadingProgressInput book={book} value={draft} unchangedBookmark={!dirty.current} labelPrefix="Book details " onEditPageCount={onEditPageCount} onBlur={commit} onChange={(patch, field) => {
      if (field !== 'mode') dirty.current = true;
      setDraft(previous => ({ ...previous, ...patch })); setError('');
    }}/>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
  </form>;
}
