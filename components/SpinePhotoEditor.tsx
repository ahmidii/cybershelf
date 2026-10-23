'use client';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, LoaderCircle, RotateCw, RotateCcw } from 'lucide-react';
import { clampSpineRatio, SPINE_PHOTO_MAX_PIXELS, spineCropGeometry } from '@/lib/spine-image';
import styles from './BookAppearance.module.css';

type Photo = { url: string; image: HTMLImageElement; width: number; height: number };

export default function SpinePhotoEditor({ file, ratio: initialRatio, onSave, onCancel }: {
  file: File; ratio: number; onSave: (image: File) => Promise<void>; onCancel: () => void;
}) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState(0), [zoom, setZoom] = useState(1);
  const [ratio, setRatio] = useState(() => clampSpineRatio(initialRatio));
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [stage, setStage] = useState({ width: 320, height: 300 });
  const stageRef = useRef<HTMLDivElement>(null);
  const live = useRef(true), saving = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const hintId = useId();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(file), image = new Image();
    setPhoto(null); setError('');
    image.onload = () => {
      if (!active) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > SPINE_PHOTO_MAX_PIXELS) {
        setError('This photo is too large to crop here. Choose one under 40 megapixels.'); return;
      }
      setPhoto({ url, image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => { if (active) setError('This photo could not be opened. Choose a PNG, JPEG, or WebP image.'); };
    image.src = url;
    return () => { active = false; image.onload = null; image.onerror = null; URL.revokeObjectURL(url); };
  }, [file]);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => { const bounds = node.getBoundingClientRect(); if (bounds.width && bounds.height) setStage({ width: bounds.width, height: bounds.height }); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const frameHeight = Math.max(80, stage.height - 36);
  const frameWidth = Math.min(Math.max(16, frameHeight * ratio), Math.max(16, stage.width - 36));
  const geometry = spineCropGeometry({ imageWidth: photo?.width ?? 1, imageHeight: photo?.height ?? 1, frameWidth, frameHeight, turns, zoom, offsetX: offset.x, offsetY: offset.y });
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!photo || busy || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: geometry.offsetX, offsetY: geometry.offsetY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current; if (!start || start.id !== event.pointerId) return;
    event.preventDefault();
    setOffset({ x: start.offsetX + event.clientX - start.x, y: start.offsetY + event.clientY - start.y });
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const positionWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!photo || busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? 12 : 3;
    setOffset({ x: geometry.offsetX + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: geometry.offsetY + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
  };
  const save = async () => {
    if (!photo || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      // Export only the selected strip, with no photograph metadata. The
      // original never leaves this browser; upright and stacked shelves use
      // this same upright image.
      const height = Math.min(1800, Math.max(1, Math.round(frameHeight / geometry.scale)));
      const width = Math.max(1, Math.round(frameWidth / frameHeight * height));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not prepare this image. Please try another photo.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
      context.translate(width / 2, height / 2);
      context.scale(width / frameWidth, height / frameHeight);
      context.translate(geometry.offsetX, geometry.offsetY);
      context.rotate(geometry.rotation * Math.PI / 180);
      context.scale(geometry.scale, geometry.scale);
      context.drawImage(photo.image, -photo.width / 2, -photo.height / 2);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not prepare the cropped image. Try again.')), 'image/jpeg', .92));
      if (!live.current) return;
      const name = file.name.replace(/\.[^.]*$/, '').slice(0, 170) || 'book';
      await onSave(new File([blob], `${name}-spine.jpg`, { type: 'image/jpeg' }));
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : 'Could not save the spine. Please try again.'); }
    finally { saving.current = false; if (live.current) setBusy(false); }
  };
  return <div className={styles.cropEditor}>
    <div className={styles.cropHeading}><strong>Frame your spine</strong><span>Preview before saving</span></div>
    <p id={hintId} className={styles.hint}>Drag the photo so the whole spine sits inside the outline. Adjust its width or rotate if needed. Arrow keys also move the photo.</p>
    <div ref={stageRef} className={styles.cropStage} tabIndex={0} role="group" aria-label="Position spine photo" aria-describedby={hintId} aria-busy={!photo && !error || busy}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={positionWithKeys}>
      {photo ? <><img src={photo.url} alt="" draggable={false} className={styles.cropPhoto} style={{ width: photo.width, height: photo.height, transform: `translate(-50%, -50%) translate(${geometry.offsetX}px, ${geometry.offsetY}px) rotate(${geometry.rotation}deg) scale(${geometry.scale})` }}/><div className={styles.cropFrame} style={{ width: frameWidth, height: frameHeight } as CSSProperties}><i/><i/><i/><i/></div></> : <span className={styles.cropLoading}>{error ? 'Choose another photo to continue.' : <><LoaderCircle size={20} className="spin"/>Opening photo…</>}</span>}
    </div>
    <div className={styles.cropSliders}>
      <label>Zoom <span>{zoom.toFixed(1)}×</span><input aria-label="Spine photo zoom" type="range" min={1} max={6} step={.05} value={zoom} disabled={!photo || busy} onChange={event => setZoom(Number(event.target.value))}/></label>
      <label>Spine width<input aria-label="Spine crop width" type="range" min={.025} max={.5} step={.005} value={ratio} disabled={!photo || busy} onChange={event => setRatio(Number(event.target.value))}/></label>
    </div>
    <div className={styles.cropActions}>
      <button type="button" className="button secondary small" disabled={!photo || busy} onClick={() => { setTurns(value => (value + 1) % 4); setOffset({ x: 0, y: 0 }); setZoom(1); }}><RotateCw size={15}/>Rotate</button>
      <button type="button" className="button quiet small" disabled={!photo || busy} onClick={() => { setTurns(0); setZoom(1); setRatio(clampSpineRatio(initialRatio)); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={15}/>Reset crop</button>
      <div className={styles.cropSaveActions}><button type="button" className="button quiet small" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="button primary small" disabled={!photo || busy} onClick={() => void save()}>{busy ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>} {busy ? 'Saving spine…' : 'Use this spine'}</button></div>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <p className={styles.cropPrivacy}>Only the cropped spine is uploaded. Your original photo stays on this device.</p>
  </div>;
}
