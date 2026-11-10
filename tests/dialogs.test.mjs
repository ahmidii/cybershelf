import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the production focus/keyboard manager with a tiny document fixture.
// No React hooks or manager decisions are replaced by test implementations.
const source = readFileSync(new URL('../lib/modal-stack.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mountModal } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));

function fixture() {
  const handlers = new Set();
  const document = {
    activeElement: null,
    addEventListener(type, action) { assert.equal(type, 'keydown'); handlers.add(action); },
    removeEventListener(type, action) { assert.equal(type, 'keydown'); handlers.delete(action); },
  };
  function element(name, children = []) {
    return {
      name, children, style: {}, attributes: new Map(), inert: false, tabIndex: -1, disabled: false, visible: true, isConnected: true,
      focus() { document.activeElement = this; },
      contains(node) { return this === node || this.children.some(child => child.contains(node)); },
      querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); },
      matches(selector) { return selector === ':disabled' && this.disabled; },
      getClientRects() { return this.visible ? [{}] : []; },
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
    };
  }
  const button = name => Object.assign(element(name), { tabIndex: 0 });
  document.body = element('body'); document.body.style.overflow = 'auto';
  function key(value, shiftKey = false, defaultPrevented = false) {
    const event = { key: value, shiftKey, defaultPrevented, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const handler of [...handlers]) handler(event);
    return event;
  }
  function modal(id, parentId = null, close = () => {}) {
    const first = button(id + '-first'), disabled = Object.assign(button(id + '-disabled'), { disabled: true }), last = button(id + '-last');
    const dialog = element(id, [first, disabled, last]), backdrop = element(id + '-backdrop', [dialog]);
    return { id, parentId, close, dialog, backdrop, first, last, disabled };
  }
  return { document, element, button, key, modal, handlers };
}

test('nested asset modal owns Escape, makes its parent inert, and returns focus to the invoking control', async () => {
  const f = fixture(), trigger = f.button('open-book'); trigger.focus();
  let parentCloses = 0, childCloses = 0;
  const parent = f.modal('book', null, () => parentCloses++), closeParent = mountModal(parent, f.document);
  parent.last.focus();
  let closeChild;
  const child = f.modal('spine', parent.id, () => { childCloses++; closeChild(); });
  closeChild = mountModal(child, f.document);
  assert.equal(f.document.activeElement, child.dialog);
  assert.equal(parent.backdrop.inert, true);
  assert.equal(parent.backdrop.attributes.get('aria-hidden'), 'true');
  assert.equal(child.backdrop.inert, false);
  assert.ok(Number(child.backdrop.style.zIndex) > Number(parent.backdrop.style.zIndex));
  const event = f.key('Escape');
  await Promise.resolve();
  assert.equal(event.defaultPrevented, true);
  assert.equal(parentCloses, 0);
  assert.equal(childCloses, 1);
  assert.equal(f.document.activeElement, parent.last);
  assert.equal(parent.backdrop.inert, false);
  assert.equal(f.document.body.style.overflow, 'hidden');
  closeParent(); await Promise.resolve();
  assert.equal(f.document.activeElement, trigger);
  assert.equal(f.document.body.style.overflow, 'auto');
  assert.equal(f.handlers.size, 0);
});

test('Tab and Shift+Tab remain inside the topmost dialog and skip disabled controls', () => {
  const f = fixture(), parent = f.modal('book'), child = f.modal('contribution', parent.id);
  const closeParent = mountModal(parent, f.document), closeChild = mountModal(child, f.document);
  child.last.focus(); assert.equal(f.key('Tab').defaultPrevented, true); assert.equal(f.document.activeElement, child.first);
  child.first.focus(); assert.equal(f.key('Tab', true).defaultPrevented, true); assert.equal(f.document.activeElement, child.last);
  parent.first.focus(); f.key('Tab'); assert.equal(f.document.activeElement, child.first);
  child.first.focus(); assert.equal(f.key('Tab').defaultPrevented, false, 'The browser should move between ordinary in-dialog controls');
  closeChild(); closeParent();
});

test('closing a parent before its nested dialog restores the original body overflow and outside focus', async () => {
  const f = fixture(); f.document.body.style.overflow = 'clip';
  const trigger = f.button('outside'); trigger.focus();
  const parent = f.modal('book'), closeParent = mountModal(parent, f.document);
  parent.first.focus();
  const child = f.modal('artwork', parent.id), closeChild = mountModal(child, f.document);
  closeParent(); parent.dialog.isConnected = false; parent.first.isConnected = false; parent.last.isConnected = false;
  assert.equal(f.document.body.style.overflow, 'hidden');
  closeChild(); await Promise.resolve();
  assert.equal(f.document.body.style.overflow, 'clip');
  assert.equal(f.document.activeElement, trigger);
  assert.equal(f.handlers.size, 0);
});

test('logical nesting wins even if a child registers before its parent', () => {
  const f = fixture(); let outer = 0, inner = 0;
  const child = f.modal('inner', 'outer', () => inner++), closeChild = mountModal(child, f.document);
  const parent = f.modal('outer', null, () => outer++), closeParent = mountModal(parent, f.document);
  f.key('Escape');
  assert.equal(inner, 1); assert.equal(outer, 0);
  assert.equal(f.document.activeElement, child.dialog);
  assert.equal(parent.backdrop.inert, true);
  closeChild(); closeParent();
});

test('an empty dialog traps Tab at its container and respects an already-handled Escape', () => {
  const f = fixture(); let closed = 0;
  const modal = f.modal('empty', null, () => closed++); modal.dialog.children = [];
  const dispose = mountModal(modal, f.document);
  f.button('outside').focus();
  assert.equal(f.key('Tab').defaultPrevented, true); assert.equal(f.document.activeElement, modal.dialog);
  f.key('Escape', false, true); assert.equal(closed, 0);
  f.key('Escape'); assert.equal(closed, 1);
  dispose(); dispose(); assert.equal(f.handlers.size, 0);
});
