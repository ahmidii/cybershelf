'use client';

import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { assetUrl, type Book, type PublicBook, type Shelf, type ShelfItem } from '../lib/types';
import { layoutShelf, type BookFacing, type PlacedShelfObject } from '../lib/shelf-geometry';
import DecorArt from './DecorArt';
import styles from './ShelfCanvas.module.css';

export interface ShelfCanvasProps {
  shelf: Shelf;
  books: (Book | PublicBook)[];
  editing?: boolean;
  selectedId?: string | null;
  onSelect?: (itemId: string) => void;
  onMove?: (itemId: string, slot: number | null) => void;
  onBookOpen?: (bookId: string) => void;
  compact?: boolean;
}

const decorNames = { plant: 'A little greenery', bear: 'Well-read teddy', robot: 'Little robot', vase: 'Ceramic vase', bookend: 'Bookend', image: 'Your decoration' };
const hash = (value: string) => Array.from(value).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
function inkFor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#fff9ec';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return r * .299 + g * .587 + b * .114 > 164 ? '#342f27' : '#fff9ec';
}

function BookObject({ book, facing, ratio }: { book: Book | PublicBook; facing: BookFacing; ratio: number }) {
  const [failedUrl, setFailedUrl] = useState('');
  const artwork = facing === 'cover' ? book.coverUrl : book.spineUrl;
  const seed = hash(book.title);
  return <span className={`${styles.book} ${styles[facing]} ${styles[`pattern${seed % 3}`]}`} style={{
    '--book-color': book.color || '#78836b', '--book-ink': inkFor(book.color),
    '--stack-art-width': `${100 / ratio}%`, '--stack-art-height': `${100 * ratio}%`,
  } as CSSProperties}>
    {facing === 'cover' ? <span className={styles.coverArt}>
      <span className={styles.coverAuthor}>{book.author}</span>
      <span className={styles.coverTitle}>{book.title}</span>
      <svg className={styles.coverMotif} viewBox="0 0 60 40" aria-hidden="true"><path d="M7 32C7 17 17 7 30 7s23 10 23 25M18 32c0-9 5-15 12-15s12 6 12 15M7 32h46" /></svg>
    </span> : <span className={styles.spineText}><span>{book.title}</span><small>{book.author}</small></span>}
    {artwork && failedUrl !== artwork ? <img className={`${styles.artwork} ${facing === 'stack' ? styles.stackArtwork : ''}`} src={artwork} alt="" loading="lazy" draggable={false} onError={() => setFailedUrl(artwork)} /> : null}
    {facing === 'spine' ? <span className={styles.publisherMark} aria-hidden="true"><i /><i /></span> : null}
    <span className={styles.pageEdge} aria-hidden="true" />
  </span>;
}

export default function ShelfCanvas({ shelf, books, editing = false, selectedId = null, onSelect, onMove, onBookOpen, compact = false }: ShelfCanvasProps) {
  const geometry = useMemo(() => layoutShelf(shelf, books), [shelf, books]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const objectRefs = useRef(new Map<string, HTMLButtonElement>());
  const bookMap = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const itemMap = useMemo(() => new Map(shelf.items.map(item => [item.id, item])), [shelf.items]);
  const bySlot = useMemo(() => new Map(shelf.items.filter(item => item.slot !== null).map(item => [item.slot!, item])), [shelf.items]);
  const selected = itemMap.get(selectedId ?? '');
  const canPlace = editing && !!selected && !selected.pinned;
  const labelFor = (item?: ShelfItem) => {
    const book = item?.kind === 'book' ? bookMap.get(item.bookId ?? '') : undefined;
    return book ? `${book.title}, by ${book.author}` : item ? item.label || decorNames[item.decor || 'image'] : '';
  };
  const dragOver = (event: DragEvent, slot: number) => {
    if (editing && dragId && !bySlot.get(slot)?.pinned) {
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOverSlot(slot);
    }
  };
  const drop = (event: DragEvent, slot: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-cybershelf-item') || event.dataTransfer.getData('text/plain');
    const source = itemMap.get(id), target = bySlot.get(slot);
    if (editing && source && !source.pinned && !target?.pinned && source.slot !== slot) onMove?.(id, slot);
    setDragId(null); setOverSlot(null);
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, item: ShelfItem) => {
    if (!editing || item.pinned || item.slot === null) return;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -geometry.columns, ArrowDown: geometry.columns };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = item.slot + step;
    if (next < 0 || next >= geometry.rows.length * geometry.columns || bySlot.get(next)?.pinned) return;
    onMove?.(item.id, next);
    requestAnimationFrame(() => objectRefs.current.get(item.id)?.focus());
  };
  const renderObject = (object: PlacedShelfObject) => {
    const item = itemMap.get(object.itemId)!;
    const book = item.kind === 'book' ? bookMap.get(item.bookId ?? '') : undefined;
    const isSelected = item.id === selectedId;
    const label = labelFor(item) || 'Book unavailable';
    const placement = {
      left: `${object.x / geometry.widthMm * 100}%`, bottom: `${object.y / geometry.rowHeightMm * 100}%`,
      width: `${object.width / geometry.widthMm * 100}%`, height: `${object.height / geometry.rowHeightMm * 100}%`,
      '--angle': `${object.angle}deg`,
    } as CSSProperties;
    return <button type="button" key={item.id} ref={node => { if (node) objectRefs.current.set(item.id, node); else objectRefs.current.delete(item.id); }}
      className={`${styles.item} ${isSelected && editing ? styles.selected : ''} ${dragId === item.id ? styles.dragging : ''} ${overSlot === item.slot ? styles.over : ''} ${item.kind === 'decor' ? styles.decoration : ''}`}
      style={placement} disabled={compact || (!editing && !book)} draggable={editing && !item.pinned}
      onDragStart={event => {
        if (!editing || item.pinned) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-cybershelf-item', item.id);
        event.dataTransfer.setData('text/plain', item.id); setDragId(item.id); onSelect?.(item.id);
      }} onDragEnd={() => { setDragId(null); setOverSlot(null); }}
      onDragOver={event => dragOver(event, item.slot!)} onDragLeave={() => setOverSlot(null)} onDrop={event => drop(event, item.slot!)}
      onClick={() => { if (editing) onSelect?.(item.id); else if (book) onBookOpen?.(book.id); }}
      onKeyDown={event => moveWithKeyboard(event, item)} aria-keyshortcuts={editing && !item.pinned ? 'ArrowLeft ArrowRight ArrowUp ArrowDown' : undefined}
      aria-label={`${label}${book ? `, ${object.facing === 'stack' ? 'stacked' : object.facing === 'spine' ? 'spine out' : 'cover out'}` : ''}${item.pinned ? ', pinned' : ''}${editing ? ', select to arrange' : ''}`}
      aria-pressed={editing ? isSelected : undefined} title={label}>
      {book ? <BookObject book={book} facing={object.facing as BookFacing} ratio={object.width / object.height} /> : item.kind === 'decor'
        ? item.decor === 'image' ? <img className={styles.customDecor} src={item.imageUrl || (item.assetId ? assetUrl(item.assetId) : '')} alt="" draggable={false} />
          : <DecorArt kind={item.decor || 'bookend'} className={styles.decorArt} />
        : <span className={styles.missing}>Book unavailable</span>}
      {editing && item.pinned ? <span className={styles.pin} aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 2h4l-.5 4L12 9H4l2.5-3zM8 9v5" /></svg></span> : null}
    </button>;
  };
  return <div className={`${styles.canvas} ${styles[shelf.finish]} ${styles[shelf.bookcase]} ${editing ? styles.editing : ''} ${compact ? styles.compact : ''}`}
    style={{ '--columns': geometry.columns, '--row-width': geometry.widthMm, '--row-height': geometry.rowHeightMm } as CSSProperties}
    role={compact ? 'img' : 'group'} aria-label={`${shelf.title} bookshelf`}>
    {editing && !compact ? <p className={styles.placementHint}>{canPlace ? 'Choose a position below to move this item. Occupied positions swap.' : 'Select a book or decoration to arrange it. You can also drag between positions.'}</p> : null}
    <div className={styles.case} aria-hidden={compact || undefined}>
      {geometry.rows.map(row => <div className={styles.row} key={row.index}>
        <div className={styles.scene}>
          {row.compartments.slice(1).map(part => <span key={part.index} className={styles.divider} aria-hidden="true" style={{ left: `${(part.x - 12) / geometry.widthMm * 100}%`, width: `${12 / geometry.widthMm * 100}%` }} />)}
          {row.compartments.flatMap(part => part.items).map(renderObject)}
        </div>
        <div className={styles.plank} aria-hidden="true" />
        {editing && !compact ? <div className={styles.positions} role="group" aria-label={`Positions on row ${row.index + 1}`}>
          {Array.from({ length: geometry.columns }, (_, column) => {
            const slot = row.index * geometry.columns + column, item = bySlot.get(slot), label = labelFor(item);
            const moving = canPlace && item?.id !== selectedId;
            const disabled = moving ? !!item?.pinned : !item;
            const message = moving
              ? `Move ${labelFor(selected)} to row ${row.index + 1}, position ${column + 1}${item ? `, swapping with ${label}` : ''}${item?.pinned ? ', pinned position' : ''}`
              : item ? `Select ${label}, row ${row.index + 1}, position ${column + 1}${item.pinned ? ', pinned' : ''}` : `Empty position ${column + 1}, row ${row.index + 1}`;
            return <button type="button" key={slot} className={`${styles.position} ${item ? styles.occupied : ''} ${item?.id === selectedId ? styles.positionSelected : ''} ${overSlot === slot ? styles.positionOver : ''}`}
              disabled={disabled} onClick={() => { if (moving && !item?.pinned) onMove?.(selected!.id, slot); else if (item) onSelect?.(item.id); }}
              onDragOver={event => dragOver(event, slot)} onDragLeave={() => setOverSlot(null)} onDrop={event => drop(event, slot)}
              aria-label={message} title={message} aria-pressed={item ? item.id === selectedId : undefined}>
              {item ? <i style={{ background: item.kind === 'book' ? bookMap.get(item.bookId ?? '')?.color || '#77856b' : '#8b9981' }} aria-hidden="true" /> : null}
              <span>{column + 1}</span>{item?.pinned ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l-.5 4L12 9H4l2.5-3zM8 9v5" /></svg> : null}
            </button>;
          })}
        </div> : null}
      </div>)}
    </div>
    <div className={styles.feet} aria-hidden="true"><i /><i /></div>
  </div>;
}
