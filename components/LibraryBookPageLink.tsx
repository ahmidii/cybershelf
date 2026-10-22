'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, LoaderCircle, Plus } from 'lucide-react';
import type { Book } from '@/lib/types';
import type { CatalogResolution } from '@/lib/book-catalog';
import { normalizeCatalogId, normalizeOpenLibraryEditionId } from '@/lib/book-catalog';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { normalizeBookISBN } from '@/lib/book-size';
import styles from './LibraryBookPageLink.module.css';

interface Props {
  book: Book; accountId: string | null;
  associate: (identity: { catalogId: string; editionId?: string }, expected: Pick<Book, 'title' | 'author' | 'isbn'>) => Promise<void>;
  flush: () => Promise<void>;
}

/** Finding a catalog work never publishes the private book record. The separate
 * creation action publishes only a title and author after an explicit choice. */
export default function LibraryBookPageLink(props: Props) {
  const { book, accountId } = props;
  const sourceKey = JSON.stringify([book.title, book.author, book.isbn || '']);
  const latest = useRef(props); latest.current = props;
  const request = useRef<AbortController | null>(null), epoch = useRef(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [resolved, setResolved] = useState<{ sourceKey: string; value: CatalogResolution } | null>(null);
  const result = resolved?.sourceKey === sourceKey ? resolved.value : null;
  useEffect(() => {
    epoch.current++; request.current?.abort(); setResolved(null); setError(''); setBusy(false);
    return () => { epoch.current++; request.current?.abort(); };
  }, [book.id, book.title, book.author, book.isbn, accountId]);
  const valid = (serial: number, targetId: string, targetAccount: string | null) => serial === epoch.current && latest.current.book.id === targetId && latest.current.accountId === targetAccount && JSON.stringify([latest.current.book.title, latest.current.book.author, latest.current.book.isbn || '']) === sourceKey;

  const open = async (identity: { catalogId: string; editionId?: string }, serial: number, targetId: string, targetAccount: string | null) => {
    const catalogId = normalizeCatalogId(identity.catalogId);
    if (!catalogId || !valid(serial, targetId, targetAccount)) return;
    await latest.current.associate({ catalogId, editionId: normalizeOpenLibraryEditionId(identity.editionId) }, { title: book.title, author: book.author, isbn: book.isbn });
    if (valid(serial, targetId, targetAccount)) window.location.assign('/books/' + encodeURIComponent(catalogId));
  };
  const find = async () => {
    if (busy) return;
    const serial = epoch.current, targetId = book.id, targetAccount = accountId;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy(true); setError(''); setResolved(null);
    try {
      const query = new URLSearchParams({ title: book.title, author: book.author });
      const isbn = normalizeBookISBN(book.isbn);
      if (isbn) query.set('isbn', isbn);
      const response = await fetch('/api/books/resolve?' + query, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const data = await response.json() as CatalogResolution & { error?: string };
      if (!response.ok) throw new Error(data.error || 'The catalog could not be checked. Please try again.');
      if (!valid(serial, targetId, targetAccount)) return;
      if (data.match) await open(data.match, serial, targetId, targetAccount);
      else setResolved({ sourceKey, value: data });
    } catch (reason) {
      if (valid(serial, targetId, targetAccount) && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This book page could not be opened.');
    } finally { if (valid(serial, targetId, targetAccount)) setBusy(false); }
  };
  const choose = async (identity: { catalogId: string; editionId?: string }) => {
    if (busy) return;
    const serial = epoch.current, targetId = book.id, targetAccount = accountId;
    setBusy(true); setError('');
    try { await open(identity, serial, targetId, targetAccount); }
    catch (reason) { if (valid(serial, targetId, targetAccount)) setError(reason instanceof Error ? reason.message : 'The book page could not be opened.'); }
    finally { if (valid(serial, targetId, targetAccount)) setBusy(false); }
  };
  const create = async () => {
    if (busy || !accountId) return;
    const serial = epoch.current, targetId = book.id, targetAccount = accountId;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      await latest.current.flush();
      if (!valid(serial, targetId, targetAccount)) return;
      const response = await fetch('/api/books/register', { method: 'POST', headers: { 'Content-Type': 'application/json', [ACCOUNT_ID_HEADER]: targetAccount }, body: JSON.stringify({ bookId: targetId }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !normalizeCatalogId(data.id)) throw new Error(data.error || 'This book page could not be created.');
      await open({ catalogId: data.id! }, serial, targetId, targetAccount);
    } catch (reason) {
      if (valid(serial, targetId, targetAccount) && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This book page could not be created.');
    } finally { if (valid(serial, targetId, targetAccount)) setBusy(false); }
  };

  const catalogId = normalizeCatalogId(book.catalogId);
  const visit = async () => {
    if (!catalogId || busy) return;
    const serial = epoch.current, targetId = book.id, targetAccount = accountId;
    setBusy(true); setError('');
    try { await latest.current.flush(); if (valid(serial, targetId, targetAccount)) window.location.assign('/books/' + encodeURIComponent(catalogId)); }
    catch (reason) { if (valid(serial, targetId, targetAccount)) setError(reason instanceof Error ? reason.message : 'Save your changes before opening the book page.'); }
    finally { if (valid(serial, targetId, targetAccount)) setBusy(false); }
  };
  if (catalogId) return <div className={styles.panel}><a className="button secondary" aria-disabled={busy} href={'/books/' + encodeURIComponent(catalogId)} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void visit(); }}>{busy ? <LoaderCircle className="spin" size={16} /> : <BookOpen size={16} />}Book page <ArrowUpRight size={14} /></a>{error && <p className="notice error" role="alert">{error}</p>}</div>;
  return <div className={styles.panel}>
    <button className="button secondary" disabled={busy} onClick={() => void find()}>{busy ? <LoaderCircle size={16} className="spin" /> : <BookOpen size={16} />}{busy ? 'Finding this book…' : 'Find book page'}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {result && <div className={styles.matches}>
      {result.candidates.length ? <><h4>Which book is yours?</h4><p>Choose the matching work. Your edition stays in your library.</p><div className={styles.candidates}>{result.candidates.map(candidate => <button disabled={busy} key={candidate.catalogId} onClick={() => void choose({ catalogId: candidate.catalogId, ...(candidate.editionId ? { editionId: candidate.editionId } : {}) })}><span><strong>{candidate.title}</strong><small>{candidate.author}{candidate.firstPublished ? ` · ${candidate.firstPublished}` : ''}</small></span><ArrowUpRight size={15} /></button>)}</div></> : <><h4>A page waiting to be written.</h4><p>No exact catalog match was found for this title and author.</p></>}
      <details><summary>{result.candidates.length ? 'None of these is my book' : 'Create a community book page'}</summary><p>Creating a page makes this book’s title and author public. Your notes, ratings, files, and source links stay private. Catalog editions can be explored on a matching Open Library page.</p>{accountId ? <button className="button secondary small" disabled={busy} onClick={() => void create()}><Plus size={14} />Create book page</button> : <a className="button secondary small" href={signInPath('/?view=library')}>Sign in to create a page <ArrowUpRight size={14} /></a>}</details>
    </div>}
  </div>;
}
