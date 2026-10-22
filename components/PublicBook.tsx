'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarDays, Check, ChevronDown, Globe, Layers3, Library, LoaderCircle, LockKeyhole, Plus, RefreshCw, Star, StarHalf, Trash2, UsersRound } from 'lucide-react';
import type { Book, BookFormat } from '@/lib/types';
import { newBook, safeExternalUrl } from '@/lib/types';
import { useLibrary } from '@/lib/use-library';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import { normalizeBookISBN } from '@/lib/book-size';
import { readingBookKey } from '@/lib/reading';
import type { CatalogBook, CatalogEdition } from '@/lib/book-catalog';
import { isCommunityReadDate, type BookCommunityMutationResponse, type BookCommunityResponse, type BookCommunityStats, type MyBookCommunity } from '@/lib/book-community';
import BrandMark from './BrandMark';
import BrandWordmark from './BrandWordmark';
import styles from './PublicBook.module.css';

interface Props { id: string; accountId: string | null; }

class BookPageError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'BookPageError'; }
}

async function request<T>(url: string, accountId: string | null, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store', credentials: 'same-origin', ...options,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { ...(accountId ? { [ACCOUNT_ID_HEADER]: accountId } : {}), ...options.headers },
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new BookPageError((data as { error?: string }).error || 'This part of the book page could not be loaded. Please try again.', response.status);
  return data as T;
}

const sameWork = (book: Book, catalog: CatalogBook) => book.catalogId ? book.catalogId === catalog.id : readingBookKey(book) === readingBookKey(catalog);
const sameEdition = (book: Book, catalog: CatalogBook, edition: CatalogEdition) => {
  if (book.catalogId && book.catalogId !== catalog.id) return false;
  if (book.editionId) return book.editionId === edition.editionId;
  const isbn = normalizeBookISBN(edition.isbn);
  return !!isbn && isbn === normalizeBookISBN(book.isbn);
};
const formatFor = (value?: string): BookFormat | undefined => {
  if (!value) return undefined;
  if (/large\s*print/i.test(value)) return 'large';
  if (/hardback|hardcover|hard cover/i.test(value)) return 'hardcover';
  if (/mass.market|pocket/i.test(value)) return 'pocket';
  if (/paperback|softback|softcover|soft cover/i.test(value)) return 'paperback';
  return undefined;
};
const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
const displayDate = (value: string) => new Date(value + 'T12:00:00.000Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const ratingLabel = (value: number) => value + (value === 1 ? ' star' : ' stars');
const languageName = (value: string) => {
  try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(value) || value; }
  catch { return value; }
};

function CatalogCover({ title, author, url, small = false }: { title: string; author?: string; url: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <div className={[styles.cover, small ? styles.smallCover : ''].join(' ')}>
    {url && !failed ? <img src={url} alt={title + ' cover'} loading={small ? 'lazy' : 'eager'} onError={() => setFailed(true)}/> : <div className={styles.coverType}><BrandMark/><strong>{title}</strong>{author && <span>{author}</span>}</div>}
  </div>;
}

function RatingStars({ value, size = 15 }: { value: number; size?: number }) {
  return <span className={styles.stars} aria-hidden="true">{[1, 2, 3, 4, 5].map(star => value >= star ? <Star key={star} size={size} fill="currentColor"/> : value >= star - .5 ? <StarHalf key={star} size={size} fill="currentColor"/> : <Star key={star} size={size}/>)}</span>;
}

export default function PublicBook(props: Props) {
  // A changed route or account gets fresh private state and request lifetimes.
  return <BookPage key={(props.accountId || 'guest') + ':' + props.id} {...props}/>;
}

function BookPage({ id, accountId }: Props) {
  const library = useLibrary(accountId);
  const [book, setBook] = useState<CatalogBook | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [loadingEditions, setLoadingEditions] = useState(false), [editionsError, setEditionsError] = useState('');
  const [stats, setStats] = useState<BookCommunityStats | null>(null), [statsLoading, setStatsLoading] = useState(true), [statsError, setStatsError] = useState('');
  const [mine, setMine] = useState<MyBookCommunity | null>(null), [mineLoading, setMineLoading] = useState(!!accountId), [mineError, setMineError] = useState('');
  const [rating, setRating] = useState(''), [readDate, setReadDate] = useState(today);
  const [communityBusy, setCommunityBusy] = useState<string | null>(null), [communityError, setCommunityError] = useState(''), [communityNotice, setCommunityNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null), [showAllReads, setShowAllReads] = useState(false);
  const [adding, setAdding] = useState<string | null>(null), [addError, setAddError] = useState(''), [addNotice, setAddNotice] = useState('');
  const [expandedDescription, setExpandedDescription] = useState(false);
  const active = useRef(true), lifetime = useRef(new AbortController());
  const catalogSequence = useRef(0), statsSequence = useRef(0), mineSequence = useRef(0);
  const pendingRead = useRef<{ date: string; id: string } | null>(null);
  const current = useRef({ id, accountId, library, book }); current.current = { id, accountId, library, book };
  const isCurrent = () => active.current && current.current.id === id && current.current.accountId === accountId;
  const endpoint = '/api/books/' + encodeURIComponent(id);
  const signInUrl = signInPath('/books/' + id);
  const canEditLibrary = library.ready && !library.accountChanged && library.status !== 'conflict';
  const canContribute = !!accountId && !!mine && !mineLoading && !mineError && !library.accountChanged;
  const copies = useMemo(() => book && library.ready ? library.state.books.filter(copy => sameWork(copy, book)).sort((left, right) => Number(right.status === 'reading') - Number(left.status === 'reading') || left.progress - right.progress) : [], [book, library.ready, library.state.books]);
  const primaryCopy = copies[0];
  const undeterminedCopy = copies.find(copy => !copy.editionId && !normalizeBookISBN(copy.isbn));
  const readTogetherUrl = primaryCopy ? '/?view=together&book=' + encodeURIComponent(primaryCopy.id) : null;
  const ratingChanged = !!mine && (rating === '' ? null : Number(rating)) !== mine.rating;
  const libraryProblem = library.accountChanged || library.status === 'conflict' || library.status === 'error';

  useEffect(() => {
    active.current = true; lifetime.current = new AbortController();
    return () => { active.current = false; lifetime.current.abort(); catalogSequence.current++; statsSequence.current++; mineSequence.current++; };
  }, []);

  const loadBook = useCallback(async () => {
    const generation = ++catalogSequence.current;
    setLoading(true); setError('');
    try {
      const result = await request<{ book: CatalogBook }>(endpoint + '?offset=0', null, { signal: lifetime.current.signal });
      if (!active.current || generation !== catalogSequence.current) return;
      setBook(result.book); setExpandedDescription(false); setEditionsError('');
    } catch (reason) { if (active.current && generation === catalogSequence.current) setError(reason instanceof Error ? reason.message : 'This book could not be opened.'); }
    finally { if (active.current && generation === catalogSequence.current) setLoading(false); }
  }, [endpoint]);

  const loadStats = useCallback(async () => {
    const generation = ++statsSequence.current;
    setStatsLoading(true); setStatsError('');
    try {
      const result = await request<BookCommunityResponse>(endpoint + '/community', null, { signal: lifetime.current.signal });
      if (active.current && generation === statsSequence.current) setStats(result.stats);
    } catch (reason) { if (active.current && generation === statsSequence.current) setStatsError(reason instanceof Error ? reason.message : 'Community totals are unavailable.'); }
    finally { if (active.current && generation === statsSequence.current) setStatsLoading(false); }
  }, [endpoint]);

  const loadMine = useCallback(async () => {
    if (!accountId) return;
    const generation = ++mineSequence.current;
    setMineLoading(true); setMineError('');
    try {
      const result = await request<MyBookCommunity>(endpoint + '/community/me', accountId, { signal: lifetime.current.signal });
      if (!active.current || generation !== mineSequence.current) return;
      setMine(result); setRating(result.rating === null ? '' : String(result.rating));
    } catch (reason) { if (active.current && generation === mineSequence.current) { setMine(null); setMineError(reason instanceof Error ? reason.message : 'Your contributions could not be opened.'); } }
    finally { if (active.current && generation === mineSequence.current) setMineLoading(false); }
  }, [accountId, endpoint]);

  useEffect(() => { void loadBook(); void loadStats(); void loadMine(); }, [loadBook, loadStats, loadMine]);

  const moreEditions = async () => {
    if (!book || book.nextEditionsOffset === null || loadingEditions) return;
    const generation = catalogSequence.current;
    setLoadingEditions(true); setEditionsError('');
    try {
      const result = await request<{ book: CatalogBook }>(endpoint + '?offset=' + book.nextEditionsOffset, null, { signal: lifetime.current.signal });
      if (!isCurrent() || generation !== catalogSequence.current) return;
      setBook(previous => previous && previous.id === result.book.id ? { ...previous, editions: [...previous.editions, ...result.book.editions.filter(edition => !previous.editions.some(prior => prior.editionId === edition.editionId))], editionCount: result.book.editionCount, nextEditionsOffset: result.book.nextEditionsOffset } : previous);
    } catch (reason) { if (isCurrent()) setEditionsError(reason instanceof Error ? reason.message : 'More editions could not be loaded.'); }
    finally { if (isCurrent()) setLoadingEditions(false); }
  };

  const addToLibrary = async (edition?: CatalogEdition) => {
    if (!book || !canEditLibrary || adding) return;
    setAdding(edition?.editionId || 'work'); setAddError(''); setAddNotice('');
    let savedId = '', updatedCopy = false;
    try {
      library.update(state => {
        const exact = edition ? state.books.find(copy => sameEdition(copy, book, edition)) : state.books.find(copy => sameWork(copy, book));
        const generic = edition ? state.books.find(copy => sameWork(copy, book) && !copy.editionId && !normalizeBookISBN(copy.isbn)) : undefined;
        const existing = exact || generic;
        const format = formatFor(edition?.physicalFormat);
        if (existing) {
          savedId = existing.id; updatedCopy = !!edition && existing.editionId !== edition.editionId;
          // Selecting an edition can fill an unidentified copy; a copy with a
          // different known edition or ISBN is never silently replaced.
          return { ...state, books: state.books.map(copy => copy.id !== existing.id ? copy : {
            ...copy, catalogId: book.id,
            ...(edition ? { editionId: edition.editionId, ...(edition.isbn ? { isbn: edition.isbn } : {}), ...(edition.pages ? { pages: edition.pages } : {}), ...(format ? { format } : {}), coverUrl: edition.coverUrl || copy.coverUrl || book.coverUrl, ...(copy.dimensions?.source === 'estimated' ? { dimensions: undefined } : {}) } : {}),
          }) };
        }
        if (state.books.length >= 2000) throw new Error('Your library has reached 2,000 books. Open Library to export a backup and make room before adding another.');
        const created: Book = {
          ...newBook(book.title, book.author), catalogId: book.id,
          coverUrl: edition?.coverUrl || book.coverUrl, description: book.description,
          ...(edition ? { editionId: edition.editionId, ...(edition.isbn ? { isbn: edition.isbn } : {}), ...(edition.pages ? { pages: edition.pages } : {}), ...(format ? { format } : {}) } : {}),
        };
        savedId = created.id;
        return { ...state, books: [...state.books, created] };
      });
      if (!savedId) throw new Error('Your library is still opening. Please try again.');
      await library.flush();
      if (!isCurrent()) return;
      setAddNotice(accountId ? updatedCopy ? 'This edition is now your library copy. Your notes and reading history are kept.' : 'Added to your library. It stays private until you choose to share it.' : updatedCopy ? 'Edition updated in your private browser draft.' : 'Added to your private browser draft.');
    } catch (reason) { if (isCurrent()) setAddError(reason instanceof Error ? reason.message : 'This book could not be saved.'); }
    finally { if (isCurrent()) setAdding(null); }
  };

  const retryLibrarySave = async () => {
    if (!canEditLibrary || adding) return;
    setAdding('retry'); setAddError('');
    try { await library.flush(); if (isCurrent()) setAddNotice('Your library change is saved.'); }
    catch (reason) { if (isCurrent()) setAddError(reason instanceof Error ? reason.message : 'Your library could not be saved.'); }
    finally { if (isCurrent()) setAdding(null); }
  };

  const contribute = async (kind: 'rating' | 'read' | 'remove', readId?: string) => {
    if (!accountId || !canContribute || communityBusy) return;
    if (kind === 'read' && !isCommunityReadDate(readDate)) { setCommunityError('Choose the calendar date when you finished this book.'); return; }
    if (kind === 'remove' && !readId) return;
    setCommunityBusy(kind === 'remove' ? 'remove:' + readId : kind); setCommunityError(''); setCommunityNotice('');
    // A response fetched before a contribution must not replace its new totals.
    statsSequence.current++; mineSequence.current++;
    try {
      let path = endpoint + '/community/rating', method = 'PUT', body: string | undefined;
      if (kind === 'rating') body = JSON.stringify({ rating: rating === '' ? null : Number(rating) });
      if (kind === 'read') {
        if (!pendingRead.current || pendingRead.current.date !== readDate) pendingRead.current = { date: readDate, id: 'read_' + crypto.randomUUID() };
        path = endpoint + '/community/reads'; method = 'POST';
        body = JSON.stringify({ id: pendingRead.current.id, finishedAt: readDate });
      }
      if (kind === 'remove') { path = endpoint + '/community/reads/' + encodeURIComponent(readId!); method = 'DELETE'; }
      const result = await request<BookCommunityMutationResponse>(path, accountId, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}), signal: lifetime.current.signal });
      if (!isCurrent()) return;
      statsSequence.current++; mineSequence.current++;
      setStats(result.stats); setStatsLoading(false); setStatsError(''); setMine(result.mine);
      if (kind === 'rating') { setRating(result.mine.rating === null ? '' : String(result.mine.rating)); setCommunityNotice(result.mine.rating === null ? 'Your community rating has been removed.' : 'Your community rating is saved.'); }
      if (kind === 'read') { pendingRead.current = null; setCommunityNotice('Your finished read is recorded in the community totals.'); }
      if (kind === 'remove') { setConfirmRemove(null); setCommunityNotice('This dated read has been removed from your contributions.'); }
    } catch (reason) {
      if (isCurrent()) {
        setCommunityError(reason instanceof Error ? reason.message : 'Your contribution could not be saved.');
        if (!stats) setStatsError('Community totals could not be refreshed.');
        if (reason instanceof BookPageError && [401, 403, 409].includes(reason.status)) { setMine(null); setMineError(reason.message); }
      }
    } finally { if (isCurrent()) { setCommunityBusy(null); setStatsLoading(false); } }
  };

  const sourceUrl = book?.sourceUrl ? safeExternalUrl(book.sourceUrl) : null;
  return <div className={styles.page}>
    <header className={styles.header}><a href="/" className={styles.brand} aria-label="Cybershelf home"><BrandWordmark/></a><nav aria-label="Public navigation"><a href="/books">Browse books</a><a href="/?view=library" className={styles.libraryLink}><Library size={15}/>Your library<ArrowUpRight size={14}/></a></nav></header>
    <main className={styles.main}>
      <a href="/books" className={styles.back}><ArrowLeft size={14}/>Books, waiting to be found</a>
      {loading ? <section className={styles.pageState} aria-busy="true" role="status"><LoaderCircle size={29} className="spin"/><h1>Opening the cover…</h1><p>A story and the readers around it.</p></section> : error || !book ? <section className={styles.pageState}><BookOpen size={34} strokeWidth={1.2}/><h1>A moment between pages.</h1><p role="alert">{error || 'This book is unavailable just now.'}</p><button type="button" className="button primary" onClick={() => void loadBook()}><RefreshCw size={14}/>Try again</button></section> : <>
        <section className={styles.hero} aria-labelledby="book-title">
          <aside className={styles.coverColumn}>
            <CatalogCover title={book.title} author={book.author} url={book.coverUrl}/>
            <button type="button" className={'button primary ' + styles.addButton} onClick={() => void addToLibrary()} disabled={!canEditLibrary || !!adding || !!primaryCopy}>{adding === 'work' ? <LoaderCircle className="spin" size={16}/> : primaryCopy ? <Check size={16}/> : <Plus size={16}/>} {primaryCopy ? 'In your library' : !library.ready ? 'Opening your library…' : 'Add to library'}</button>
            {readTogetherUrl ? <a href={readTogetherUrl} className={'button secondary ' + styles.togetherButton}><UsersRound size={15}/>Read together<ArrowUpRight size={14}/></a> : book.editions.length > 0 ? <a href="#editions" className={styles.editionJump}>Find your edition<ChevronDown size={13}/></a> : null}
            <p className={styles.privateNote}><LockKeyhole size={12}/><span>{accountId ? 'Your library and reading notes stay private.' : 'Guest adds stay in this browser. Sign in to keep a library across devices.'}</span></p>
            {!accountId && <a href={signInUrl} className={styles.signInLink}>Sign in to cybershelf<ArrowUpRight size={12}/></a>}
          </aside>
          <div className={styles.bookStory}>
            <p className={styles.eyebrow}>{book.source === 'community' ? 'A BOOK IN THE CYBERSHELF COMMUNITY' : 'ONE BOOK, MANY READING LIVES'}</p>
            <h1 id="book-title">{book.title}</h1>
            <p className={styles.author}>by {book.authors.length ? book.authors.join(', ') : book.author}</p>
            {book.firstPublished && <p className={styles.firstPublished}>First published {book.firstPublished}</p>}
            <div className={styles.stats} aria-label="Community reading statistics" aria-busy={statsLoading}>
              <div className={styles.average}><span className={styles.statNumber}><span className="sr-only">Average rating: </span>{stats?.averageRating === null || !stats ? '—' : stats.averageRating.toFixed(1)}</span><div><RatingStars value={stats?.averageRating || 0}/><span>{stats ? stats.ratingCount ? stats.ratingCount.toLocaleString() + (stats.ratingCount === 1 ? ' community rating' : ' community ratings') : 'No ratings yet' : statsLoading ? 'Loading ratings…' : 'Ratings unavailable'}</span></div></div>
              <div><span className={styles.statNumber}>{stats ? stats.readCount.toLocaleString() : '—'}</span><span>finished {stats?.readCount === 1 ? 'read' : 'reads'}</span></div>
              <div><span className={styles.statNumber}>{stats ? stats.readerCount.toLocaleString() : '—'}</span><span>{stats?.readerCount === 1 ? 'reader' : 'readers'}</span></div>
            </div>
            {statsError ? <div className={styles.compactError} role="alert"><p>{statsError}</p><button type="button" className="text-button" onClick={() => void loadStats()} disabled={statsLoading || !!communityBusy}><RefreshCw size={12}/>Refresh totals</button></div> : <p className={styles.statsNote}>From ratings and finished reads shared on cybershelf.</p>}
            <div className={styles.synopsis}>
              {book.description ? <><p id="book-description" className={!expandedDescription && book.description.length > 550 ? styles.shortDescription : ''}>{book.description}</p>{book.description.length > 550 && <button type="button" className="text-button" aria-expanded={expandedDescription} aria-controls="book-description" onClick={() => setExpandedDescription(value => !value)}>{expandedDescription ? 'A little less' : 'Read the full description'}<ChevronDown size={13} className={expandedDescription ? styles.turnUp : ''}/></button>}</> : <p className={styles.noDescription}>This book is still finding its words here. Add it to your library and make a place for the story.</p>}
            </div>
            {book.subjects.length > 0 && <div className={styles.subjects} aria-label="Book subjects">{book.subjects.slice(0, 9).map(subject => <span key={subject}>{subject}</span>)}</div>}
            <p className={styles.catalogCredit}>{book.source === 'openlibrary' ? <><Globe size={12}/>Book information from Open Library.{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">View record<ArrowUpRight size={12}/></a>}</> : <><BookOpen size={12}/>A community book record. Catalog editions are not linked yet.</>}</p>
          </div>
        </section>

        {addNotice && <p className={styles.notice} role="status"><Check size={15}/>{addNotice}</p>}
        {(addError || libraryProblem) && <div className={styles.libraryError} role="alert"><div><strong>Your library needs a moment.</strong><p>{addError || library.error}</p></div><div>{accountId && canEditLibrary && addError ? <button type="button" className="button secondary small" disabled={!!adding} onClick={() => void retryLibrarySave()}>{adding === 'retry' ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>}Retry saving</button> : !library.ready && !library.accountChanged ? <button type="button" className="button secondary small" onClick={() => void library.reload()}><RefreshCw size={13}/>Try loading again</button> : null}<a href="/?view=library" className="text-button">Open your library<ArrowUpRight size={12}/></a></div></div>}

        <div className={styles.below}>
          <section className={styles.editions} id="editions" aria-labelledby="editions-title">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>THE COPY THAT FEELS LIKE YOURS</p><h2 id="editions-title">Different covers. Same story.</h2></div>{book.editionCount > 0 && <span>{book.editionCount.toLocaleString()} {book.editionCount === 1 ? 'edition' : 'editions'}</span>}</div>
            <p className={styles.sectionIntro}>Choose an edition for its cover, ISBN, and page count. Your bookshelf can hold more than one copy.</p>
            {book.editions.length ? <div className={styles.editionGrid}>{book.editions.map(edition => {
              const saved = library.ready ? library.state.books.find(copy => sameEdition(copy, book, edition)) : undefined;
              const editionBusy = adding === edition.editionId;
              const linked = saved?.catalogId === book.id && saved.editionId === edition.editionId;
              return <article className={styles.edition} key={edition.editionId}>
                <CatalogCover small title={edition.title} url={edition.coverUrl || book.coverUrl}/>
                <div className={styles.editionWords}><h3>{edition.title}</h3><p className={styles.editionPublisher}>{edition.publishers.length ? edition.publishers.join(' · ') : 'Publisher not listed'}{edition.publishDate && <span>{edition.publishDate}</span>}</p>
                  <div className={styles.editionMeta}>{edition.physicalFormat && <span>{edition.physicalFormat}</span>}{edition.pages && <span>{edition.pages.toLocaleString()} pages</span>}{edition.languages.length > 0 && <span>{edition.languages.map(languageName).join(', ')}</span>}</div>
                  {edition.isbn && <p className={styles.isbn}>ISBN {edition.isbn}</p>}
                  <button type="button" className={'button ' + (linked ? 'quiet' : 'secondary') + ' small'} disabled={!canEditLibrary || !!adding || linked} onClick={() => void addToLibrary(edition)}>{editionBusy ? <LoaderCircle size={13} className="spin"/> : linked ? <Check size={13}/> : <Plus size={13}/>} {linked ? 'In your library' : saved || undeterminedCopy ? 'Use this edition' : 'Add this edition'}</button>
                </div>
              </article>;
            })}</div> : <div className={styles.noEditions}><Layers3 size={29} strokeWidth={1.3}/><h3>{book.source === 'community' ? 'This story is here. Its editions are still to come.' : 'No editions are listed here yet.'}</h3><p>You can add the book now and set the cover, ISBN, and page count in your private Book details.</p></div>}
            {editionsError && <p className={styles.inlineError} role="alert">{editionsError}</p>}
            {book.nextEditionsOffset !== null && <div className={styles.moreEditions}><button type="button" className="button secondary" onClick={() => void moreEditions()} disabled={loadingEditions}>{loadingEditions ? <LoaderCircle size={15} className="spin"/> : <ChevronDown size={15}/>} {editionsError ? 'Try more editions again' : 'Show more editions'}</button><span>{book.editions.length.toLocaleString()} shown</span></div>}
            {undeterminedCopy && book.editions.length > 0 && <p className={styles.editionHelp}>“Use this edition” fills the copy already in your library. Your thoughts, notes, and reading progress are kept.</p>}
          </section>

          <aside className={styles.community} aria-labelledby="community-title">
            <div className={styles.communityIntro}><span className={styles.communityIcon}><UsersRound size={21} strokeWidth={1.5}/></span><p className={styles.eyebrow}>YOUR PART IN THE STORY</p><h2 id="community-title">A book lives in its readers.</h2><p>Your community rating and finished reads help other readers find their next book.</p></div>
            {!accountId ? <div className={styles.guestContribution}><p>Sign in to leave a rating, record a finished read, or find your reading circle.</p><a href={signInUrl} className="button primary">Sign in to join in<ArrowUpRight size={14}/></a><p className={styles.contributionPrivacy}><LockKeyhole size={12}/>Adding a book to your library does not share a rating or reading history.</p></div> : mineLoading ? <div className={styles.communityLoading} role="status"><LoaderCircle size={19} className="spin"/>Opening your reading record…</div> : mineError ? <div className={styles.communityLoadError} role="alert"><p>{mineError}</p><button type="button" className="button secondary small" onClick={() => void loadMine()}><RefreshCw size={13}/>Refresh my contributions</button></div> : mine ? <>
              <form className={styles.ratingForm} onSubmit={event => { event.preventDefault(); void contribute('rating'); }}>
                <label htmlFor="community-rating">Your community rating</label>
                <div className={styles.ratingChoice}><select id="community-rating" value={rating} onChange={event => setRating(event.target.value)} disabled={!canContribute || !!communityBusy}><option value="">Unrated</option>{Array.from({ length: 10 }, (_, index) => (index + 1) / 2).map(value => <option key={value} value={value}>{ratingLabel(value)}</option>)}</select><RatingStars value={Number(rating) || 0} size={19}/></div>
                <button type="submit" className="button secondary" disabled={!canContribute || !!communityBusy || !ratingChanged}>{communityBusy === 'rating' ? <LoaderCircle className="spin" size={14}/> : <Star size={14}/>} {rating === '' && mine.rating !== null ? 'Remove community rating' : 'Save community rating'}</button>
                <p className={styles.contributionHelp}>This contributes to the public average. Your private library rating stays as you set it.</p>
              </form>
              <div className={styles.readForm}>
                <div className={styles.readHeading}><CalendarDays size={17}/><h3>A finished read</h3></div>
                <form onSubmit={event => { event.preventDefault(); void contribute('read'); }}><label htmlFor="finished-read-date">When did you turn the last page?</label><input id="finished-read-date" type="date" value={readDate} max={today()} required disabled={!canContribute || !!communityBusy} onChange={event => setReadDate(event.target.value)}/><button type="submit" className="button secondary" disabled={!canContribute || !!communityBusy}>{communityBusy === 'read' ? <LoaderCircle className="spin" size={14}/> : <Plus size={14}/>}Add finished read</button></form>
                <p className={styles.contributionHelp}>Each dated finish contributes to this book’s totals. Add another date for a reread. Your private reading status is unchanged.</p>
                {mine.hasSharedCompletion && <p className={styles.completionNote}><Check size={13}/>Your shared finishing update already counts one read. A dated entry records that same finish; a new date can record a reread.</p>}
              </div>
              {mine.reads.length > 0 && <div className={styles.myReads}><div><h3>Your dated reads</h3><span>{mine.reads.length}</span></div><ul>{(showAllReads ? mine.reads : mine.reads.slice(0, 4)).map(read => <li key={read.id}><time dateTime={read.finishedAt}>{displayDate(read.finishedAt)}</time>{confirmRemove === read.id ? <span className={styles.removeRead}><button type="button" disabled={!!communityBusy || !canContribute} onClick={() => void contribute('remove', read.id)}>{communityBusy === 'remove:' + read.id ? 'Removing…' : 'Remove'}</button><button type="button" disabled={!!communityBusy} onClick={() => setConfirmRemove(null)}>Keep</button></span> : <button type="button" className="icon-button" disabled={!!communityBusy || !canContribute} aria-label={'Remove finished read from ' + displayDate(read.finishedAt)} onClick={() => setConfirmRemove(read.id)}><Trash2 size={13}/></button>}</li>)}</ul>{mine.reads.length > 4 && <button type="button" className="text-button" onClick={() => setShowAllReads(value => !value)}>{showAllReads ? 'Show recent reads' : 'Show all dated reads'}<ChevronDown size={12}/></button>}</div>}
              {communityError && <div className={styles.inlineError} role="alert"><p>{communityError}</p><button type="button" className="text-button" onClick={() => { void loadMine(); void loadStats(); }} disabled={!!communityBusy}><RefreshCw size={12}/>Refresh contributions</button></div>}
              {communityNotice && <p className={styles.communityNotice} role="status"><Check size={13}/>{communityNotice}</p>}
            </> : null}
            <div className={styles.readingInvitation}><BookOpen size={19} strokeWidth={1.5}/><div><h3>Company, at your own pace.</h3><p>Your circle’s shared thoughts meet you at your bookmark in Reading together.</p>{readTogetherUrl ? <a href={readTogetherUrl}>Open this book with your circle<ArrowUpRight size={12}/></a> : <a href="/?view=library">Make a home for your reading<ArrowUpRight size={12}/></a>}</div></div>
          </aside>
        </div>
      </>}
    </main>
    <footer className={styles.footer}><a href="/" className={styles.brand}><BrandWordmark/></a><p>Your books. Your little corner of the internet.</p><a href="/books">Find another story<ArrowUpRight size={13}/></a></footer>
  </div>;
}
