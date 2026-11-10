interface ModalRegistration {
  id: string;
  parentId: string | null;
  dialog: HTMLElement;
  backdrop: HTMLElement;
  close: () => void;
}
interface Entry extends ModalRegistration { order: number; returnFocus: HTMLElement[]; }
interface ModalState { entries: Map<string, Entry>; nextOrder: number; overflow: string; key: (event: KeyboardEvent) => void; }
const documents = new WeakMap<Document, ModalState>();

function ordered(state: ModalState) {
  const path = (entry: Entry) => {
    const result = [entry.order], seen = new Set([entry.id]);
    let parent = entry.parentId ? state.entries.get(entry.parentId) : undefined;
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); result.unshift(parent.order); parent = parent.parentId ? state.entries.get(parent.parentId) : undefined; }
    return result;
  };
  return [...state.entries.values()].sort((a, b) => {
    const first = path(a), second = path(b);
    for (let index = 0; index < Math.min(first.length, second.length); index++) if (first[index] !== second[index]) return first[index] - second[index];
    return first.length - second.length;
  });
}
function syncLayers(state: ModalState) {
  const entries = ordered(state);
  entries.forEach((entry, index) => {
    const top = index === entries.length - 1;
    entry.backdrop.style.zIndex = String(100 + index);
    entry.backdrop.inert = !top;
    if (top) entry.backdrop.removeAttribute('aria-hidden'); else entry.backdrop.setAttribute('aria-hidden', 'true');
    entry.dialog.setAttribute('aria-modal', top ? 'true' : 'false');
  });
  return entries.at(-1);
}
function focusedElement(document: Document): HTMLElement | null {
  const candidate = document.activeElement as HTMLElement | null;
  return candidate && typeof candidate.focus === 'function' ? candidate : null;
}

/** One keyboard/focus owner for all portals in this document. Registration
 * preserves the React parent relationship even though portals are DOM siblings. */
export function mountModal(registration: ModalRegistration, owner: Document = document): () => void {
  let state = documents.get(owner);
  if (!state) {
    state = { entries: new Map(), nextOrder: 0, overflow: owner.body.style.overflow, key: () => {} };
    const current = state;
    state.key = event => {
      if (event.defaultPrevented) return;
      const top = ordered(current).at(-1);
      if (!top) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); top.close(); return; }
      if (event.key !== 'Tab') return;
      const targets = Array.from(top.dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]'))
        .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0);
      if (!targets.length) { event.preventDefault(); top.dialog.focus(); return; }
      const first = targets[0], last = targets[targets.length - 1], active = owner.activeElement;
      if (event.shiftKey && (active === first || active === top.dialog || !top.dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || active === top.dialog || !top.dialog.contains(active))) { event.preventDefault(); first.focus(); }
    };
    owner.body.style.overflow = 'hidden';
    owner.addEventListener('keydown', state.key);
    documents.set(owner, state);
  }
  const active = focusedElement(owner), parent = registration.parentId ? state.entries.get(registration.parentId) : undefined;
  const entry: Entry = { ...registration, order: state.nextOrder++, returnFocus: [...new Set([...(active ? [active] : []), ...(parent?.returnFocus ?? [])])] };
  state.entries.set(entry.id, entry);
  const top = syncLayers(state);
  if (top && !top.dialog.contains(owner.activeElement)) top.dialog.focus();
  const captured = state;
  return () => {
    if (captured.entries.get(entry.id) !== entry) return;
    const wasTop = ordered(captured).at(-1) === entry;
    // Keep the original trigger available if a parent closes before its child.
    for (const child of captured.entries.values()) if (child.parentId === entry.id) child.returnFocus = [...new Set([...child.returnFocus, ...entry.returnFocus])];
    captured.entries.delete(entry.id);
    const remaining = syncLayers(captured);
    if (!captured.entries.size) {
      owner.body.style.overflow = captured.overflow;
      owner.removeEventListener('keydown', captured.key);
      documents.delete(owner);
    }
    if (wasTop) queueMicrotask(() => {
      const latest = documents.get(owner), next = latest ? ordered(latest).at(-1) : undefined;
      const previous = entry.returnFocus.find(node => node.isConnected && (!next || next.dialog.contains(node)));
      if (previous) previous.focus({ preventScroll: true }); else (next ?? remaining)?.dialog.focus({ preventScroll: true });
    });
  };
}
