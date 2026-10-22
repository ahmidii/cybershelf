'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl, type Book, type PublicBook, type Shelf, type ShelfItem } from '../lib/types';
import { bookDimensions } from '../lib/book-size';
import { facingForItem, layoutShelf, type BookFacing, type PlacedShelfObject } from '../lib/shelf-geometry';
import { placeShelfItem, type PlacementMode } from '../lib/shelf-placement';
import DecorArt from './DecorArt';
import styles from './ShelfCanvas.module.css';

export interface ExternalShelfDrag {
  itemId: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  pointerType?: string;
}
export interface ShelfCanvasProps {
  shelf: Shelf;
  books: (Book | PublicBook)[];
  editing?: boolean;
  selectedId?: string | null;
  onSelect?: (itemId: string) => void;
  onDeselect?: () => void;
  onPlace?: (nextShelf: Shelf, itemId: string) => void;
  /** Kept for consumers upgrading from the old slot-based canvas. */
  onMove?: (itemId: string, slot: number | null) => void;
  onBookOpen?: (bookId: string) => void;
  externalDrag?: ExternalShelfDrag | null;
  onExternalDragEnd?: () => void;
  compact?: boolean;
}

type PlacementResult = ReturnType<typeof placeShelfItem>;
type PlacementTarget = Parameters<typeof placeShelfItem>[3];
type Point = { x: number; y: number };
type Interaction = {
  itemId: string;
  kind: 'pointer' | 'keyboard' | 'tap';
  pointerId: number | null;
  pointerType: string;
  start: Point;
  point: Point;
  gripXmm: number;
  gripYmm: number;
  active: boolean;
  external: boolean;
  baseShelf: Shelf;
  books: (Book | PublicBook)[];
  source?: PlacedShelfObject;
  sourceRow: number;
  mode: PlacementMode;
  target: PlacementTarget | null;
  result: PlacementResult | null;
};

const MODES: { id: PlacementMode; label: string; description: string }[] = [
  { id: 'auto', label: 'Auto', description: 'Let the shelf find a natural pose' },
  { id: 'spine', label: 'Spine', description: 'Stand with the spine facing out' },
  { id: 'cover', label: 'Cover', description: 'Display the front cover' },
  { id: 'stack', label: 'Stack', description: 'Lay flat or add to a pile' },
  { id: 'lean-left', label: 'Lean left', description: 'Lean against support on the left' },
  { id: 'lean-right', label: 'Lean right', description: 'Lean against support on the right' },
];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function ModeIcon({ mode }: { mode: PlacementMode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {mode === 'auto' ? <><path d="m12 3 1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9Z" /><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7Z" /></>
      : mode === 'stack' ? <><rect x="3" y="11" width="18" height="5" rx="1" /><path d="M5 19h14M6 13.5h12" /></>
      : mode === 'cover' ? <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M8 3v18M11 8h5M11 11h4" /></>
      : <g transform={mode === 'lean-left' ? 'rotate(-16 12 20)' : mode === 'lean-right' ? 'rotate(16 12 20)' : undefined}><rect x="9" y="3" width="6" height="18" rx="1" /><path d="M10.5 6h3M10.5 17h3" /></g>}
  </svg>;
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

export default function ShelfCanvas({ shelf, books, editing = false, selectedId = null, onSelect, onDeselect, onPlace, onBookOpen, externalDrag = null, onExternalDragEnd, compact = false }: ShelfCanvasProps) {
  const geometry = useMemo(() => layoutShelf(shelf, books), [shelf, books]);
  const bookMap = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const itemMap = useMemo(() => new Map(shelf.items.map(item => [item.id, item])), [shelf.items]);
  const selected = itemMap.get(selectedId ?? '');
  const interactive = !!onPlace && !compact;
  const instructionsId = useId();
  const [view, setView] = useState<Interaction | null>(null);
  const [mode, setMode] = useState<PlacementMode>('auto');
  const [announcement, setAnnouncement] = useState('');
  const [mounted, setMounted] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const objectRefs = useRef(new Map<string, HTMLButtonElement>());
  const interaction = useRef<Interaction | null>(null);
  const frame = useRef<number | null>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const wheel = useRef({ total: 0, at: 0, eventAt: 0, direction: 0 });
  const latest = useRef({ shelf, books, geometry, selectedId, selected, interactive, editing, onSelect, onDeselect, onPlace, onBookOpen, onExternalDragEnd, mode });
  latest.current = { shelf, books, geometry, selectedId, selected, interactive, editing, onSelect, onDeselect, onPlace, onBookOpen, onExternalDragEnd, mode };

  const labelFor = (item?: ShelfItem) => {
    const book = item?.kind === 'book' ? bookMap.get(item.bookId ?? '') : undefined;
    return book ? `${book.title}, by ${book.author}` : item ? item.label || decorNames[item.decor || 'image'] : '';
  };
  const currentPose = (id: string) => {
    for (const row of latest.current.geometry.rows) {
      const object = row.compartments.flatMap(part => part.items).find(item => item.itemId === id);
      if (object) return { object, row: row.index };
    }
    return null;
  };
  const emitView = (session: Interaction) => setView({ ...session });
  const initialPoseSize = (session: Interaction) => {
    const object = session.source;
    if (object) return { width: object.bounds.width, height: object.bounds.height };
    const item = session.baseShelf.items.find(value => value.id === session.itemId);
    const book = session.books.find(value => value.id === item?.bookId);
    if (!book) return { width: 120, height: 170 };
    const dimensions = bookDimensions(book);
    const facing = session.mode === 'cover' ? 'cover' : session.mode === 'stack' ? 'stack' : item ? facingForItem(item, session.baseShelf) : 'spine';
    return { width: facing === 'stack' ? dimensions.heightMm : facing === 'cover' ? dimensions.widthMm : dimensions.thicknessMm,
      height: facing === 'stack' ? dimensions.thicknessMm : dimensions.heightMm };
  };
  const targetAt = (session: Interaction, point: Point, preserveGrip = true): PlacementTarget | null => {
    let closest: { index: number; rect: DOMRect; distance: number } | null = null;
    for (const [index, node] of rowRefs.current) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || point.x < rect.left - 28 || point.x > rect.right + 28) continue;
      const distance = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
      if (distance <= 30 && (!closest || distance < closest.distance)) closest = { index, rect, distance };
    }
    if (!closest) return null;
    const { rect } = closest;
    const mmPerPixel = latest.current.geometry.widthMm / rect.width;
    const gripX = preserveGrip ? session.gripXmm : 0;
    const gripY = preserveGrip ? session.gripYmm : 0;
    return {
      row: closest.index,
      x: clamp(((point.x - rect.left) * mmPerPixel - gripX) / latest.current.geometry.widthMm, 0, 1),
      y: clamp((rect.bottom - point.y) * mmPerPixel - gripY, 0, latest.current.geometry.rowHeightMm),
      mode: session.mode,
    };
  };
  const refresh = (session: Interaction, target = session.target) => {
    session.target = target;
    session.result = target ? placeShelfItem(session.baseShelf, session.books, session.itemId, { ...target, mode: session.mode }) : null;
    emitView(session);
  };
  const refreshPointer = () => {
    frame.current = null;
    const session = interaction.current;
    if (!session?.active || session.kind !== 'pointer') return;
    refresh(session, targetAt(session, session.point));
  };
  const schedulePointer = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(() => actions.current?.refreshPointer());
  };
  const stopFrames = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    frame.current = null; autoScrollFrame.current = null;
  };
  const clearInteraction = () => {
    const session = interaction.current;
    interaction.current = null;
    stopFrames(); setView(null);
    if (session?.pointerId !== null && session?.pointerId !== undefined) {
      try { if (canvasRef.current?.hasPointerCapture(session.pointerId)) canvasRef.current.releasePointerCapture(session.pointerId); } catch { /* A canceled pointer has already released capture. */ }
    }
    if (session?.external) latest.current.onExternalDragEnd?.();
    return session;
  };
  const restoreFocus = (id: string) => requestAnimationFrame(() => objectRefs.current.get(id)?.focus({ preventScroll: true }));
  const commit = () => {
    const session = interaction.current;
    if (!session) return;
    const result = session.result;
    suppressClickUntil.current = performance.now() + 650;
    clearInteraction();
    if (result?.valid && latest.current.shelf === session.baseShelf && latest.current.interactive) {
      latest.current.onPlace?.(result.shelf, session.itemId);
      setAnnouncement(`Placed. ${result.hint}`);
    } else setAnnouncement(result?.hint || 'Placement canceled. The item is back where you found it.');
    restoreFocus(session.itemId);
  };
  const cancel = (clearSelection = false) => {
    const session = clearInteraction();
    if (session) {
      suppressClickUntil.current = performance.now() + 650;
      setAnnouncement('Placement canceled. The item is back where you found it.');
      restoreFocus(session.itemId);
    }
    if (clearSelection) {
      setDismissedId(latest.current.selectedId);
      latest.current.onDeselect?.();
    }
  };
  const autoScroll = () => {
    autoScrollFrame.current = null;
    const session = interaction.current;
    if (!session?.active || session.kind !== 'pointer') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect && session.point.x >= rect.left - 40 && session.point.x <= rect.right + 40) {
      const topEdge = 76, bottomEdge = window.innerHeight - 160;
      const delta = session.point.y < topEdge ? -Math.min(15, (topEdge - session.point.y) * .22)
        : session.point.y > bottomEdge ? Math.min(15, (session.point.y - bottomEdge) * .22) : 0;
      if (delta && ((delta < 0 && rect.top < 0) || (delta > 0 && rect.bottom > bottomEdge))) {
        const before = window.scrollY;
        window.scrollBy({ top: delta, behavior: 'instant' });
        if (window.scrollY !== before) actions.current?.refreshPointer();
      }
    }
    autoScrollFrame.current = requestAnimationFrame(() => actions.current?.autoScroll());
  };
  const activate = (session: Interaction) => {
    session.active = true;
    setDismissedId(null);
    latest.current.onSelect?.(session.itemId);
    setAnnouncement('Lifted. Move to any spot. Scroll or press R to turn. Escape cancels.');
    if (autoScrollFrame.current === null && session.kind === 'pointer') autoScrollFrame.current = requestAnimationFrame(() => actions.current?.autoScroll());
  };
  const startPointer = (itemId: string, pointerId: number, point: Point, pointerType: string, external = false, element?: HTMLElement) => {
    const context = latest.current;
    if (!context.interactive || interaction.current || !context.shelf.items.some(item => item.id === itemId)) return;
    const pose = currentPose(itemId), rect = element?.getBoundingClientRect();
    const session: Interaction = {
      itemId, kind: 'pointer', pointerId, pointerType, start: point, point,
      gripXmm: 0, gripYmm: 0,
      active: false, external, baseShelf: context.shelf, books: context.books,
      source: pose?.object, sourceRow: pose?.row ?? 0,
      mode: context.selectedId === itemId ? context.mode : 'auto', target: null, result: null,
    };
    // Keep a physical grip for the entire gesture. Reusing preview dimensions here
    // would move the target after a pose change, making drop differ from its ghost.
    const size = initialPoseSize(session);
    session.gripXmm = (rect?.width ? clamp((point.x - rect.left) / rect.width - .5, -.5, .5) : 0) * size.width;
    session.gripYmm = (rect?.height ? clamp((rect.bottom - point.y) / rect.height, 0, 1) : .45) * size.height;
    interaction.current = session;
    setMode(session.mode); wheel.current = { total: 0, at: 0, eventAt: 0, direction: 0 };
    try { canvasRef.current?.setPointerCapture(pointerId); } catch { /* Window listeners also cover an externally started pointer. */ }
  };
  const startLift = (itemId: string, kind: 'keyboard' | 'tap') => {
    const context = latest.current, pose = currentPose(itemId);
    if (!context.interactive || interaction.current) return;
    const session: Interaction = { itemId, kind, pointerId: null, pointerType: '', start: { x: 0, y: 0 }, point: { x: 0, y: 0 }, gripXmm: 0, gripYmm: 0,
      active: true, external: false, baseShelf: context.shelf, books: context.books, source: pose?.object, sourceRow: pose?.row ?? 0,
      mode: context.selectedId === itemId ? context.mode : 'auto', target: { row: pose?.row ?? 0, x: pose ? (pose.object.anchorX ?? pose.object.bounds.x + pose.object.bounds.width / 2) / context.geometry.widthMm : .5, y: pose?.object.bounds.y ?? 0 }, result: null };
    interaction.current = session; setMode(session.mode); activate(session); refresh(session);
  };
  const movePointer = (event: PointerEvent) => {
    const session = interaction.current;
    if (!session || session.kind !== 'pointer' || event.pointerId !== session.pointerId) return;
    session.point = { x: event.clientX, y: event.clientY };
    if (!session.active && Math.hypot(session.point.x - session.start.x, session.point.y - session.start.y) >= (session.pointerType === 'touch' ? 7 : 5)) activate(session);
    if (session.active) { event.preventDefault(); schedulePointer(); }
  };
  const finishPointer = (event: PointerEvent) => {
    const session = interaction.current;
    if (!session || session.kind !== 'pointer' || event.pointerId !== session.pointerId) return;
    if (session.active) {
      event.preventDefault();
      session.point = { x: event.clientX, y: event.clientY };
      const overControls = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-shelf-controls]');
      if (overControls) { cancel(); return; }
      refresh(session, targetAt(session, session.point)); commit();
    } else {
      clearInteraction(); suppressClickUntil.current = performance.now() + 650;
      const item = latest.current.shelf.items.find(value => value.id === session.itemId);
      if (!item) return;
      setDismissedId(null);
      if (latest.current.editing || session.external || item.kind === 'decor') latest.current.onSelect?.(item.id);
      else if (item.bookId) latest.current.onBookOpen?.(item.bookId);
    }
  };
  const changeMode = (nextMode: PlacementMode) => {
    setMode(nextMode); latest.current.mode = nextMode;
    let session = interaction.current;
    if (session) {
      session.mode = nextMode;
      if (session.active) refresh(session, session.kind === 'pointer' ? targetAt(session, session.point) : session.target);
      return;
    }
    const item = latest.current.selected;
    if (!item) return;
    const pose = currentPose(item.id);
    if (!pose) { setAnnouncement(`${MODES.find(value => value.id === nextMode)?.label}. Tap a spot on the shelf to place it.`); return; }
    const result = placeShelfItem(latest.current.shelf, latest.current.books, item.id, { row: pose.row,
      x: (pose.object.anchorX ?? pose.object.bounds.x + pose.object.bounds.width / 2) / latest.current.geometry.widthMm, y: pose.object.bounds.y, mode: nextMode });
    if (result.valid) {
      latest.current.onPlace?.(result.shelf, item.id);
      setAnnouncement(result.hint);
    } else {
      startLift(item.id, 'tap'); session = interaction.current;
      if (session) { session.mode = nextMode; refresh(session); }
      setAnnouncement(result.hint);
    }
  };
  const cycle = (direction: number) => {
    const session = interaction.current;
    if (!session?.active || session.baseShelf.items.find(item => item.id === session.itemId)?.kind !== 'book') return;
    const index = MODES.findIndex(value => value.id === session.mode);
    changeMode(MODES[(index + direction + MODES.length) % MODES.length].id);
  };
  const handleWheel = (event: WheelEvent) => {
    const session = interaction.current;
    if (!session?.active || event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
    if (!delta) return;
    const now = performance.now(), direction = Math.sign(delta);
    if (direction !== wheel.current.direction || now - wheel.current.eventAt > 260) wheel.current.total = 0;
    wheel.current.direction = direction; wheel.current.eventAt = now; wheel.current.total += delta;
    if (Math.abs(wheel.current.total) >= 34 && now - wheel.current.at >= 150) {
      cycle(direction); wheel.current.total = 0; wheel.current.at = now;
    }
  };
  const handleKey = (event: KeyboardEvent | ReactKeyboardEvent) => {
    const session = interaction.current;
    if (!session?.active) return false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return true; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); commit(); return true; }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); event.stopPropagation(); cycle(event.shiftKey ? -1 : 1); return true; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return false;
    event.preventDefault(); event.stopPropagation();
    if (session.kind === 'pointer') return true;
    const target = session.target ?? { row: 0, x: .5, y: 0 };
    const step = (event.shiftKey ? 2 : 12) / latest.current.geometry.widthMm;
    if (event.key === 'ArrowLeft') target.x = clamp(target.x - step, 0, 1);
    if (event.key === 'ArrowRight') target.x = clamp(target.x + step, 0, 1);
    if (event.key === 'Home') target.x = 0;
    if (event.key === 'End') target.x = 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      if (event.altKey) target.y = clamp(target.y - direction * 18, 0, latest.current.geometry.rowHeightMm);
      else { target.row = clamp(target.row + direction, 0, latest.current.geometry.rows.length - 1); target.y = 0; }
    }
    refresh(session, { ...target });
    setAnnouncement(`${session.result?.hint ?? 'Move to another spot.'} Row ${target.row + 1}.`);
    rowRefs.current.get(target.row)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    return true;
  };
  const actions = useRef({ refreshPointer, autoScroll, movePointer, finishPointer, handleWheel, handleKey, cancel });
  actions.current = { refreshPointer, autoScroll, movePointer, finishPointer, handleWheel, handleKey, cancel };

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!interactive) return;
    const move = (event: PointerEvent) => actions.current.movePointer(event);
    const up = (event: PointerEvent) => actions.current.finishPointer(event);
    const lost = (event: PointerEvent) => { if (interaction.current?.pointerId === event.pointerId) actions.current.cancel(); };
    const wheelEvent = (event: WheelEvent) => actions.current.handleWheel(event);
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement)?.closest('[data-shelf-controls] button')) return;
      if (interaction.current) actions.current.handleKey(event);
      else if (event.key === 'Escape' && latest.current.selectedId) actions.current.cancel(true);
    };
    const blur = () => { if (interaction.current) actions.current.cancel(); };
    const visibility = () => { if (document.hidden) blur(); };
    const scroll = () => { if (interaction.current?.kind === 'pointer' && interaction.current.active) schedulePointer(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up, { passive: false });
    window.addEventListener('pointercancel', lost);
    window.addEventListener('wheel', wheelEvent, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    window.addEventListener('scroll', scroll, { passive: true, capture: true });
    window.addEventListener('resize', scroll, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', lost);
      window.removeEventListener('wheel', wheelEvent); window.removeEventListener('keydown', key); window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); document.removeEventListener('visibilitychange', visibility);
      const session = interaction.current; interaction.current = null; stopFrames();
      if (session?.external) latest.current.onExternalDragEnd?.();
    };
  }, [interactive]);
  useEffect(() => {
    const session = interaction.current;
    if (session && (!interactive || shelf !== session.baseShelf || books !== session.books)) cancel();
  }, [shelf, books, interactive]);
  useEffect(() => {
    if (!interaction.current) { setMode('auto'); setDismissedId(null); }
  }, [selectedId]);
  useEffect(() => {
    if (externalDrag && interactive) startPointer(externalDrag.itemId, externalDrag.pointerId, { x: externalDrag.clientX, y: externalDrag.clientY }, externalDrag.pointerType || 'mouse', true);
  }, [externalDrag, interactive]);

  const pressObject = (event: ReactPointerEvent<HTMLButtonElement>, item: ShelfItem) => {
    if (!interactive || event.button !== 0 || !event.isPrimary || interaction.current) return;
    // A tray book or a deliberately lifted item can be placed onto another book.
    if (selected?.slot === null && selected.id !== item.id && selectedId !== dismissedId) return;
    event.preventDefault(); event.stopPropagation();
    let picked = item, element = event.currentTarget;
    // Narrow spines get a larger invisible grip. If grips overlap, the actual
    // book closest to the finger wins, rather than the last DOM sibling.
    if (event.pointerType === 'touch') {
      let nearest = Infinity;
      for (const [id, node] of objectRefs.current) {
        const rect = node.getBoundingClientRect();
        const dx = Math.max(rect.left - event.clientX, event.clientX - rect.right, 0);
        const dy = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
        if (dx > 14 || dy > 8) continue;
        const distance = Math.hypot(dx, dy) + Math.abs((rect.left + rect.right) / 2 - event.clientX) * .001;
        const candidate = itemMap.get(id);
        if (candidate && distance < nearest) { nearest = distance; picked = candidate; element = node; }
      }
    }
    startPointer(picked.id, event.pointerId, { x: event.clientX, y: event.clientY }, event.pointerType, false, element);
  };
  const activateObject = (item: ShelfItem) => {
    if (performance.now() < suppressClickUntil.current) return;
    if (editing && interactive) { setDismissedId(null); onSelect?.(item.id); }
    else if (item.bookId) onBookOpen?.(item.bookId);
    else if (interactive) { setDismissedId(null); onSelect?.(item.id); }
  };
  const keyObject = (event: ReactKeyboardEvent<HTMLButtonElement>, item: ShelfItem) => {
    if (!interactive) return;
    if (interaction.current?.active) { handleKey(event); return; }
    if (event.key === ' ' || event.key.toLowerCase() === 'r' || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); startLift(item.id, 'keyboard');
      if (event.key !== ' ') handleKey(event);
    }
  };
  const placeFromClick = (event: ReactMouseEvent<HTMLDivElement>, row: number) => {
    if (!interactive || performance.now() < suppressClickUntil.current) return;
    const session = interaction.current;
    const item = session?.active ? itemMap.get(session.itemId) : selected;
    if (!item || (!session && selectedId === dismissedId)) return;
    const hitItem = (event.target as HTMLElement).closest('[data-shelf-item]');
    if (hitItem && !session && item.slot !== null) return;
    event.preventDefault(); event.stopPropagation();
    if (!session) startLift(item.id, 'tap');
    const active = interaction.current;
    if (!active || active.kind === 'pointer') return;
    const target = targetAt(active, { x: event.clientX, y: event.clientY }, false);
    if (!target) return;
    refresh(active, { ...target, row }); commit();
  };
  const renderArtwork = (item: ShelfItem, object: PlacedShelfObject) => {
    const book = item.kind === 'book' ? bookMap.get(item.bookId ?? '') : undefined;
    return book ? <BookObject book={book} facing={object.facing as BookFacing} ratio={object.width / object.height} />
      : item.kind === 'decor' ? item.decor === 'image' ? <img className={styles.customDecor} src={item.imageUrl || (item.assetId ? assetUrl(item.assetId) : '')} alt="" draggable={false} />
        : <DecorArt kind={item.decor || 'bookend'} className={styles.decorArt} />
      : <span className={styles.missing}>Book unavailable</span>;
  };
  const placementStyle = (object: PlacedShelfObject): CSSProperties => ({
    left: `${object.x / geometry.widthMm * 100}%`, bottom: `${object.y / geometry.rowHeightMm * 100}%`,
    width: `${object.width / geometry.widthMm * 100}%`, height: `${object.height / geometry.rowHeightMm * 100}%`, '--angle': `${object.angle}deg`,
  } as CSSProperties);
  const active = !!view?.active;
  const visibleGeometry = active && view.result ? view.result.geometry : geometry;
  const activeItem = itemMap.get(view?.itemId ?? selectedId ?? '');
  const paletteVisible = interactive && !!activeItem && (active || selectedId !== dismissedId);
  const renderObject = (object: PlacedShelfObject) => {
    const item = itemMap.get(object.itemId);
    if (!item) return null;
    const book = item.kind === 'book' ? bookMap.get(item.bookId ?? '') : undefined;
    const isGhost = active && item.id === view?.itemId;
    const isSelected = interactive && item.id === selectedId && selectedId !== dismissedId;
    const label = labelFor(item) || 'Book unavailable';
    return <button type="button" key={item.id} data-shelf-item={item.id} data-facing={object.facing} data-placement-ghost={isGhost || undefined}
      ref={node => { if (node) objectRefs.current.set(item.id, node); else objectRefs.current.delete(item.id); }}
      className={`${styles.item} ${isSelected && !isGhost ? styles.selected : ''} ${isGhost ? styles.ghost : ''} ${isGhost && !view.result?.valid ? styles.blocked : ''} ${item.kind === 'decor' ? styles.decoration : ''}`}
      style={placementStyle(object)} disabled={compact || (!interactive && !book)} draggable={false}
      onPointerDown={event => pressObject(event, item)} onDragStart={event => event.preventDefault()} onContextMenu={event => { if (interactive) event.preventDefault(); }}
      onClick={() => activateObject(item)} onKeyDown={event => keyObject(event, item)}
      aria-keyshortcuts={interactive ? 'Space ArrowLeft ArrowRight ArrowUp ArrowDown R Enter Escape' : undefined}
      aria-describedby={interactive ? instructionsId : undefined}
      aria-label={`${label}${book ? `, ${object.facing === 'stack' ? 'stacked' : object.facing === 'spine' ? 'spine out' : 'cover out'}` : ''}${interactive ? ', drag to arrange' : ''}`}
      aria-pressed={interactive ? isSelected : undefined} title={label}>
      {renderArtwork(item, object)}
    </button>;
  };
  const palette = paletteVisible && activeItem ? <div className={styles.palette} data-shelf-controls="true" role="group" aria-label="Book placement controls" aria-describedby={instructionsId}
    onPointerDown={event => event.stopPropagation()}>
    <div className={styles.paletteHeading}><span>{labelFor(activeItem).split(', by ')[0]}</span><button type="button" onClick={() => cancel(true)} aria-label={active ? 'Cancel placement' : 'Done arranging'}>{active ? 'Cancel' : 'Done'}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button></div>
    {activeItem.kind === 'book' ? <div className={styles.modeOptions} role="group" aria-label="Display style">
      {MODES.map(option => <button type="button" key={option.id} aria-pressed={(view?.mode ?? mode) === option.id}
        className={(view?.mode ?? mode) === option.id ? styles.modeActive : ''}
        aria-label={option.label} title={option.description}
        onPointerDown={event => { if (event.pointerType === 'touch' && !event.isPrimary && interaction.current?.active) { event.preventDefault(); changeMode(option.id); } }}
        onClick={() => changeMode(option.id)}><ModeIcon mode={option.id} /><span>{option.label}</span></button>)}
    </div> : null}
    <div className={styles.paletteFooter}><span>{active ? view.result?.hint || 'Bring it over a shelf.' : activeItem.slot === null ? 'Tap a spot on the shelf, or drag it in.' : activeItem.kind === 'decor' ? 'Drag anywhere, including onto a stack.' : 'Drag anywhere. Scroll while holding to turn.'}</span>
      {active && view.kind !== 'pointer' ? <button type="button" className={styles.placeButton} onClick={commit} disabled={!view.result?.valid}>Place here</button>
        : !active ? <button type="button" className={styles.moveButton} onClick={() => startLift(activeItem.id, 'tap')}>{activeItem.slot === null ? 'Place on shelf' : 'Pick up'}</button> : null}
    </div>
  </div> : null;

  return <div ref={canvasRef} className={`${styles.canvas} ${styles[shelf.finish]} ${styles[shelf.bookcase]} ${interactive ? styles.interactive : ''} ${editing ? styles.editing : ''} ${active ? styles.inMotion : ''} ${compact ? styles.compact : ''}`}
    style={{ '--row-width': geometry.widthMm, '--row-height': geometry.rowHeightMm } as CSSProperties}
    onLostPointerCapture={event => { if (interaction.current?.pointerId === event.pointerId) cancel(); }}
    role={compact ? 'img' : 'group'} aria-label={`${shelf.title} bookshelf`}>
    {interactive && editing ? <p className={styles.placementHint}>Drag to any spot. Scroll while holding to turn. Books find their footing.</p> : null}
    {interactive ? <span className={styles.srOnly} id={instructionsId}>Drag to move. Press Space to pick up, arrows to move, R to turn, Enter to place, or Escape to cancel. Shift and arrow moves a little. Alt and up or down adjusts stacking height.</span> : null}
    <div className={styles.case} aria-hidden={compact || undefined}>
      {visibleGeometry.rows.map(row => <div className={`${styles.row} ${active && view.target?.row === row.index ? styles.targetRow : ''}`} key={row.index}>
        <div className={styles.scene} data-shelf-row={row.index} ref={node => { if (node) rowRefs.current.set(row.index, node); else rowRefs.current.delete(row.index); }}
          onClickCapture={event => placeFromClick(event, row.index)}>
          {row.compartments.slice(1).map(part => <span key={part.index} className={styles.divider} aria-hidden="true" style={{ left: `${(part.x - 12) / geometry.widthMm * 100}%`, width: `${12 / geometry.widthMm * 100}%` }} />)}
          {active && view.source && view.sourceRow === row.index ? <span className={`${styles.sourceTrace} ${styles.item}`} aria-hidden="true" style={placementStyle(view.source)} /> : null}
          {row.compartments.flatMap(part => part.items).map(renderObject)}
        </div>
        <div className={styles.plank} aria-hidden="true" />
      </div>)}
    </div>
    <div className={styles.feet} aria-hidden="true"><i /><i /></div>
    {interactive ? <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</span> : null}
    {mounted && palette ? createPortal(palette, document.body) : null}
    {mounted && active && view.kind === 'pointer' ? createPortal(<div className={`${styles.dragTag} ${view.result && !view.result.valid ? styles.dragTagBlocked : ''}`}
      style={{ left: clamp(view.point.x + 18, 10, window.innerWidth - 175), top: Math.max(10, view.point.y - (view.pointerType === 'touch' ? 78 : 46)) }} aria-hidden="true">
      {activeItem?.kind === 'book' ? <ModeIcon mode={view.mode} /> : null}<span>{view.result?.valid ? MODES.find(option => option.id === view.mode)?.label || 'Place here' : view.result ? 'Try a little more space' : 'Over a shelf to place'}</span>
    </div>, document.body) : null}
  </div>;
}
