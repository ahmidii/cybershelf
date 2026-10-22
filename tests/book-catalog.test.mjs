import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

mkdirSync('.sites-runtime', { recursive: true });
const directory = mkdtempSync(resolve('.sites-runtime/catalog-test-'));
function compile(source, name, replacements = {}) {
  let code = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`from '${from}'`, `from '${to}'`);
  const output = resolve(directory, `${name}.mjs`); writeFileSync(output, code);
  return pathToFileURL(output).href;
}
const sharedURL = compile('lib/book-catalog.ts', 'shared');
compile('lib/book-size.ts', 'size');
// Authentication is outside this public catalog boundary. Retain the real
// HttpError contract while avoiding a Cloudflare session dependency in Node.
writeFileSync(resolve(directory, 'http.mjs'), 'export class HttpError extends Error { constructor(status,message,code){super(message);this.status=status;this.code=code;} }');
const serverURL = compile('lib/server/book-catalog.ts', 'server', {
  './http': './http.mjs', '../book-size': './size.mjs', '../book-catalog': './shared.mjs',
});
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
const shared = await import(sharedURL);
let sequence = 0;
const fresh = () => import(`${serverURL}?test=${++sequence}`);

function upstream(t, handler) {
  let clock = 1_000_000;
  const timers = globalThis.setTimeout;
  const requests = [];
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'setTimeout', (fn, delay = 0, ...args) => {
    clock += delay;
    return timers(fn, 0, ...args);
  });
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options, at: clock });
    const result = handler(url, requests.length);
    return result instanceof Response ? result : Response.json(result);
  });
  return requests;
}

test('catalog identities distinguish works, chosen editions and explicit community books', () => {
  assert.equal(shared.normalizeCatalogId('/works/OL45804W'), 'OL45804W');
  assert.equal(shared.normalizeOpenLibraryEditionId('/books/OL7353617M'), 'OL7353617M');
  assert.equal(shared.normalizeCatalogId(`cs_${'a'.repeat(64)}`), `cs_${'a'.repeat(64)}`);
  for (const value of ['https://evil.test/works/OL1W', '/works/OL1W.json', '../OL1W', 'OL1M', `cs_${'a'.repeat(63)}`, 'OL1W?secret=1']) {
    assert.equal(shared.normalizeCatalogId(value), undefined, value);
  }
  assert.equal(shared.catalogMatchText('J. R. R. Tolkien'), shared.catalogMatchText('J.R.R. Tolkien'));
  assert.notEqual(shared.catalogMatchText('Dune'), shared.catalogMatchText('Dune Messiah'));
  assert.notEqual(shared.catalogMatchText('Jose'), shared.catalogMatchText('José'));
});

test('work pages preserve edition identity, paginate raw records and reuse public cached requests', async t => {
  const requests = upstream(t, url => {
    if (url.pathname === '/works/OL45804W.json') return { key: '/works/OL45804W', title: 'Fantastic Mr Fox', description: { value: 'A catalog description.' }, covers: [-1, 123], subjects: ['Foxes', 'Foxes', 'Fiction'], isbn_13: ['9780980200447'], number_of_pages: 500 };
    if (url.pathname === '/search.json') return { docs: [{ key: '/works/OL45804W', author_name: ['Roald Dahl'], first_publish_year: 1970 }] };
    assert.equal(url.searchParams.get('limit'), '24');
    const offset = Number(url.searchParams.get('offset'));
    if (offset) return { size: 4, entries: [{ key: '/books/OL3M', title: 'Another edition', works: [{ key: '/works/OL45804W' }], isbn_10: ['0140328726'] }] };
    return { size: 4, entries: [
      { key: '/books/OL1M', title: 'Fantastic Mr Fox', works: [{ key: '/works/OL45804W' }], isbn_13: ['bad', '9780140328721'], number_of_pages: 96, physical_format: 'Paperback', languages: [{ key: '/languages/eng' }], publishers: ['Penguin'], publish_date: '2007', covers: [11], privateExtra: 'NEVER_INCLUDE' },
      { key: '/books/OL2M', title: 'Wrong work', works: [{ key: '/works/OL999W' }], number_of_pages: 700 },
      { key: '/books/OL1M', title: 'Duplicate' },
    ] };
  });
  const catalog = await fresh();
  const [book, duplicate] = await Promise.all([catalog.lookupCatalogBook('OL45804W'), catalog.lookupCatalogBook('OL45804W')]);
  assert.deepEqual(book, duplicate);
  assert.equal(requests.length, 3);
  assert.equal(book.id, 'OL45804W'); assert.equal(book.author, 'Roald Dahl');
  assert.equal(book.isbn, undefined); assert.equal(book.pages, undefined);
  assert.equal(book.editions[0].isbn, '9780140328721'); assert.equal(book.editions[0].pages, 96);
  assert.equal(book.editions.length, 1); assert.equal(book.nextEditionsOffset, 3);
  assert.equal(JSON.stringify(book).includes('NEVER_INCLUDE'), false);
  assert.deepEqual(book.subjects, ['Foxes', 'Fiction']);
  const second = await catalog.lookupCatalogBook('OL45804W', 3);
  assert.equal(second.editions[0].editionId, 'OL3M'); assert.equal(second.nextEditionsOffset, null);
  assert.equal(requests.length, 4);
  for (let i = 1; i < requests.length; i++) assert.ok(requests[i].at - requests[i - 1].at >= 1000);
  assert.equal(requests[0].options.credentials, 'omit');
  await assert.rejects(catalog.lookupCatalogBook('OL45804W', -1), error => error.status === 400);
});

test('missing search-index authors are resolved only through the requested work author references', async t => {
  upstream(t, url => {
    if (url.pathname.startsWith('/works/')) return { key: '/works/OL7W', title: 'A new work', authors: [{ author: { key: '/authors/OL9A' } }, { author: { key: 'https://evil.test/profile' } }] };
    if (url.pathname === '/search.json') return { docs: [{ key: '/works/OL999W', author_name: ['Unrelated Person'] }] };
    assert.equal(url.pathname, '/authors/OL9A.json'); return { key: '/authors/OL9A', name: 'Actual Author' };
  });
  const work = await (await fresh()).lookupCatalogWork('OL7W');
  assert.equal(work.author, 'Actual Author');
});

test('title-author resolution rejects ambiguous, truncated, unknown-author and near-title results', async t => {
  const exact = { key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'] };
  let response = { numFound: 1, numFoundExact: true, docs: [exact] };
  upstream(t, () => response);
  assert.deepEqual((await (await fresh()).resolveCatalogBook({ title: 'Dune', author: 'Frank Herbert' })).match, { catalogId: 'OL1W' });
  response = { numFound: 2, docs: [exact, { ...exact, key: '/works/OL2W' }] };
  assert.equal((await (await fresh()).resolveCatalogBook({ title: 'Dune', author: 'Frank Herbert' })).match, null);
  response = { numFound: 100, docs: [exact] };
  assert.equal((await (await fresh()).resolveCatalogBook({ title: 'Dune', author: 'Frank Herbert' })).match, null);
  response = { numFound: 1, docs: [exact] };
  assert.equal((await (await fresh()).resolveCatalogBook({ title: 'Dune', author: 'Unknown author' })).match, null);
  assert.equal((await (await fresh()).resolveCatalogBook({ title: 'Dune: a study', author: 'Frank Herbert' })).match, null);
  assert.equal((await (await fresh()).resolveCatalogBook({ title: 'Dune', author: 'Someone Else' })).match, null);
});

test('ISBN resolution verifies edition identifiers and a single work before attaching identity', async t => {
  let response = { key: '/books/OL7353617M', isbn_10: ['0140328726'], works: [{ key: '/works/OL45804W' }] };
  upstream(t, () => response);
  assert.deepEqual((await (await fresh()).resolveCatalogBook({ isbn: '9780140328721' })).match, { catalogId: 'OL45804W', editionId: 'OL7353617M' });
  response = { ...response, isbn_10: ['9999999999'] };
  assert.equal((await (await fresh()).resolveCatalogBook({ isbn: '9780140328721' })).match, null);
  response = { ...response, isbn_10: ['0140328726'], works: [{ key: '/works/OL45804W' }, { key: '/works/OL9W' }] };
  assert.equal((await (await fresh()).resolveCatalogBook({ isbn: '9780140328721' })).match, null);
});

test('catalog fetch rejects outside hosts, redirects, oversized streams and malformed JSON without caching failures', async t => {
  let mode = 'redirect';
  let canceled = false;
  const requests = upstream(t, () => {
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.test/private' } });
    if (mode === 'large') return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { canceled = true; },
    }));
    if (mode === 'invalid') return new Response('{');
    return { key: '/works/OL1W', title: 'Good result' };
  });
  const catalog = await fresh(), url = new URL('https://openlibrary.org/works/OL1W.json');
  await assert.rejects(catalog.openLibraryJSON(new URL('https://evil.test/works/OL1W.json')), error => error.status === 400);
  assert.equal(requests.length, 0);
  await assert.rejects(catalog.openLibraryJSON(url), error => error.status === 503);
  assert.equal(requests.length, 1);
  mode = 'large'; await assert.rejects(catalog.openLibraryJSON(url), error => error.status === 503); assert.equal(canceled, true);
  mode = 'invalid'; await assert.rejects(catalog.openLibraryJSON(url), error => error.status === 503);
  mode = 'valid'; assert.equal((await catalog.openLibraryJSON(url)).title, 'Good result');
  assert.equal(requests.length, 4);
});

test('not-found works stay distinct from temporary failures, and old ISBN appearance remains compatible', async t => {
  upstream(t, url => url.pathname.startsWith('/works/') ? new Response(null, { status: 404 }) : { isbn_13: ['9780140328721'], physical_format: 'Paperback', number_of_pages: 96 });
  const catalog = await fresh();
  assert.equal(await catalog.lookupCatalogWork('OL1W'), null);
  const appearance = await catalog.lookupEdition('9780140328721');
  assert.equal(appearance.pages, 96); assert.equal(appearance.format, 'paperback');
  assert.equal(await catalog.lookupEdition('9780140328722'), null);
});
