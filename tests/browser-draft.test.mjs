import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/browser-draft.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { adoptBrowserDraft, BROWSER_DRAFT_KEY, canRestoreBrowserDraft, removeSavedBrowserDraft } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'),
);

function starter() {
  return {
    schemaVersion: 1,
    profile: { name: 'My chosen pen name', bio: '' }, books: [],
    shelves: [{ id: 'starter', title: 'A shelf of my own', description: '', bookcase: 'open', layout: 'balanced', finish: 'paper', items: [], updatedAt: '2026-01-01T00:00:00.000Z' }],
  };
}

test('a browser draft keeps the account identity and the reader’s guest arrangement', () => {
  const current = starter(), draft = starter();
  draft.profile = { name: 'Demo reader', bio: 'A guest reading bio', featuredShelfId: 'guest-shelf' };
  draft.books = [{ id: 'guest-book', title: 'My draft book', notes: 'A private note' }];
  draft.shelves[0].id = 'guest-shelf';
  draft.shelves[0].items = [{ id: 'plant', kind: 'decor', decor: 'plant', slot: 0 }];
  const adopted = adoptBrowserDraft(current, draft);
  assert.equal(adopted.profile.name, 'My chosen pen name');
  assert.equal(adopted.profile.bio, 'A guest reading bio');
  assert.equal(adopted.profile.featuredShelfId, 'guest-shelf');
  assert.deepEqual(adopted.books, draft.books);
  assert.deepEqual(adopted.shelves, draft.shelves);
  assert.equal(current.books.length, 0, 'Preparing an import does not mutate the account');
  assert.equal(draft.profile.name, 'Demo reader', 'Preparing an import does not rewrite the browser draft');
  current.profile.bio = 'An account bio';
  assert.equal(adoptBrowserDraft(current, draft).profile.bio, 'An account bio');
});

test('an empty book list never permits replacing a customized, decorated, or shared account shelf', () => {
  assert.equal(canRestoreBrowserDraft(starter()), true);
  assert.equal(canRestoreBrowserDraft({ ...starter(), shelves: [] }), true);
  const changes = [
    state => { state.shelves[0].items.push({ id: 'plant', kind: 'decor' }); },
    state => { state.shelves[0].title = 'My plant collection'; },
    state => { state.shelves[0].description = 'Waiting for a book'; },
    state => { state.shelves[0].bookcase = 'tower'; },
    state => { state.shelves[0].layout = 'stacks'; },
    state => { state.shelves[0].finish = 'oak'; },
    state => { state.shelves[0].publicId = 'shared'; },
    state => { state.shelves.push({ ...state.shelves[0], id: 'second' }); },
    state => { state.profile.featuredShelfId = state.shelves[0].id; },
    state => { state.books.push({ id: 'saved-book' }); },
    state => { state.connections = [{ id: 'saved-connection' }]; },
  ];
  for (const change of changes) {
    const current = starter(); change(current);
    const before = structuredClone(current);
    assert.equal(canRestoreBrowserDraft(current), false);
    assert.throws(() => adoptBrowserDraft(current, starter()), /already has a collection/);
    assert.deepEqual(current, before, 'Refusing an import leaves existing account work intact');
  }
});

test('saved guest-draft cleanup removes only the exact draft imported by that account', () => {
  const stored = new Map([[BROWSER_DRAFT_KEY, 'imported draft'], ['other-key', 'keep']]);
  const storage = { getItem: key => stored.get(key) ?? null, removeItem: key => stored.delete(key) };
  assert.equal(removeSavedBrowserDraft(storage, 'imported draft'), true);
  assert.equal(stored.has(BROWSER_DRAFT_KEY), false);
  assert.equal(stored.get('other-key'), 'keep');
  stored.set(BROWSER_DRAFT_KEY, 'new work from another tab');
  assert.equal(removeSavedBrowserDraft(storage, 'imported draft'), false);
  assert.equal(stored.get(BROWSER_DRAFT_KEY), 'new work from another tab');
  assert.equal(removeSavedBrowserDraft({ ...storage, getItem: () => null }, 'imported draft'), false);
});
