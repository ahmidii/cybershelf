import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginHardcoverAuthorization, consumeHardcoverAuthorization, HARDCOVER_SCOPES, mapHardcoverBook } from '../lib/connections/hardcover';

const options = { clientId: 'test-client-id', accountId: 'reader-one', redirectUri: 'https://cybershelf.io/connect/hardcover' };
const access = 'hc_at_access_for_this_test_only', refresh = 'hc_rt_refresh_for_this_test_only';
const tokens = { access_token: access, refresh_token: refresh, expires_in: 604800, token_type: 'Bearer', scope: HARDCOVER_SCOPES };
const pendingKey = 'cybershelf.hardcover.pending.v1';
function row(id = 1) {
  return {
    id, book_id: 77, status_id: 2, owned: true, rating: 4.5, updated_at: '2026-10-22T10:00:00Z',
    private_notes: 'Never import this.', review: 'Never publish this.',
    book: { id: 77, title: 'Catalog title', slug: 'the-reading-life', pages: 300, image: { url: 'https://images.example/cover.jpg' }, contributions: [{ contribution: 'Author', author: { name: 'An Author' } }, { contribution: 'Translator', author: { name: 'A Translator' } }] },
    edition: { id: 88, title: 'The Reading Life', pages: 400, isbn_13: '978-0-00-000000-2' },
    user_book_reads: [{ id: 99, progress_pages: 100, progress: 0.9, edition: { id: 88, pages: 400 }, finished_at: null }],
  };
}

/** A small browser boundary fake. No credentials or real accounts are used. */
async function browser(run: (context: {
  storage: Map<string, string>;
  navigate: (url: string) => void;
  url: () => string;
}) => Promise<void>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  let current = new URL('https://cybershelf.io/');
  const fakeWindow = {
    location: {
      get href() { return current.href; },
      get origin() { return current.origin; },
      assign(value: string) { current = new URL(value, current); },
    },
    history: { state: null, replaceState(_state: unknown, _unused: string, value: string) { current = new URL(value, current); } },
    sessionStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  try { await run({ storage, navigate: url => { current = new URL(url); }, url: () => current.href }); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function callback(storage: Map<string, string>, extra: Record<string, string> = {}): string {
  const pending = JSON.parse(storage.get(pendingKey)!);
  return `${options.redirectUri}?${new URLSearchParams({ code: 'test_code', state: pending.state, iss: 'https://api.hardcover.app', ...extra })}`;
}

test('Hardcover mapping separates the selected edition and exact reading position from catalog fallback data', () => {
  const book = mapHardcoverBook(row())!;
  assert.equal(book.title, 'The Reading Life');
  assert.equal(book.author, 'An Author');
  assert.equal(book.pages, 400);
  assert.equal(book.isbn, '9780000000002');
  assert.equal(book.progress, 25);
  assert.equal(book.status, 'reading');
  assert.equal(book.rating, 4.5);
  assert.equal(book.owned, true);
  assert.equal(book.url, 'https://hardcover.app/books/the-reading-life');
  assert.equal(JSON.stringify(book).includes('Never'), false);
  assert.equal('private_notes' in book, false);
  assert.equal('review' in book, false);
});

test('Hardcover does not invent a position from a different edition, undocumented fractional progress, or an old finished read', () => {
  const sample = row();
  assert.equal(mapHardcoverBook({ ...sample, user_book_reads: [{ progress: 0.7, progress_pages: 100 }] })!.progress, undefined);
  assert.equal(mapHardcoverBook({ ...sample, user_book_reads: [{ ...sample.user_book_reads[0], finished_at: '2026-01-01' }] })!.progress, undefined);
  assert.equal(mapHardcoverBook({ ...sample, user_book_reads: [{ ...sample.user_book_reads[0], progress_pages: 401 }] })!.progress, undefined);
  assert.equal(mapHardcoverBook({ ...sample, user_book_reads: [{ progress_seconds: 200, edition: { audio_seconds: 800 } }] })!.progress, 25);
  assert.equal(mapHardcoverBook({ ...sample, status_id: 3 })!.progress, 100);
  assert.equal(mapHardcoverBook({ ...sample, status_id: 1 })!.progress, 0);
  assert.equal(mapHardcoverBook({ ...sample, status_id: 6 }), null);
  assert.equal(mapHardcoverBook({ ...sample, edition: null, book: { ...sample.book, image: { url: 'javascript:alert(1)' } } })!.coverUrl, '');
});

test('Hardcover starts read-only OAuth with PKCE, no token storage, and an exact registered callback', async () => {
  await browser(async ({ storage, url }) => {
    await beginHardcoverAuthorization(options);
    const authorization = new URL(url()), pending = JSON.parse(storage.get(pendingKey)!);
    assert.equal(authorization.origin + authorization.pathname, 'https://hardcover.app/oauth2/authorize');
    assert.equal(authorization.searchParams.get('scope'), HARDCOVER_SCOPES);
    assert.equal(HARDCOVER_SCOPES.includes('write:'), false);
    assert.equal(HARDCOVER_SCOPES.includes('email'), false);
    assert.equal(authorization.searchParams.get('redirect_uri'), options.redirectUri);
    const expected = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier))).toString('base64url');
    assert.equal(authorization.searchParams.get('code_challenge'), expected);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('state'), pending.state);
    assert.equal(pending.accountId, options.accountId);
    assert.equal(authorization.href.includes(pending.verifier), false);
    await assert.rejects(beginHardcoverAuthorization({ ...options, redirectUri: 'https://other.example/connect/hardcover' }), /return address/);
  });
});

test('Hardcover callbacks reject mismatched account, issuer, expired state and replay before any token request', async () => {
  await browser(async ({ storage, navigate, url }) => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('must not call'); };
    await beginHardcoverAuthorization(options);
    const first = callback(storage);
    navigate(first);
    await assert.rejects(consumeHardcoverAuthorization({ ...options, accountId: 'another-reader' }), /different sign-in/);
    assert.equal(url(), options.redirectUri);
    assert.equal(storage.has(pendingKey), false);
    navigate(first);
    await assert.rejects(consumeHardcoverAuthorization(options), /different sign-in/);
    await beginHardcoverAuthorization(options);
    navigate(callback(storage, { iss: 'https://attacker.example' }));
    await assert.rejects(consumeHardcoverAuthorization(options), /different sign-in/);
    await beginHardcoverAuthorization(options);
    const pending = JSON.parse(storage.get(pendingKey)!);
    pending.createdAt = Date.now() - 11 * 60 * 1000;
    storage.set(pendingKey, JSON.stringify(pending));
    navigate(callback(storage));
    await assert.rejects(consumeHardcoverAuthorization(options), /expired/);
    assert.equal(requests, 0);
    assert.equal(await consumeHardcoverAuthorization(options), null);
  });
});

test('Hardcover library sync is paginated directly to the provider and returns no credentials or unrelated account details', async () => {
  await browser(async ({ storage, navigate }) => {
    const calls: { url: string; init: RequestInit; payload: Record<string, unknown> }[] = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(init.redirect, 'error');
      if (url.endsWith('/oauth2/token')) return json(tokens);
      if (url.endsWith('/oauth2/revoke')) return new Response(null, { status: 200 });
      assert.equal(url, 'https://api.hardcover.app/v1/graphql');
      assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${access}`);
      const payload = JSON.parse(String(init.body));
      calls.push({ url, init, payload });
      if (payload.query.includes('CybershelfIdentity')) return json({ data: { me: [{ id: 123, username: 'reader' }] } });
      assert.equal(payload.variables.userId, 123);
      return json({ data: { user_books: payload.variables.after === 0 ? Array.from({ length: 100 }, (_, i) => row(i + 1)) : [row(101)] } });
    };
    await beginHardcoverAuthorization(options);
    navigate(callback(storage));
    const session = (await consumeHardcoverAuthorization(options))!;
    assert.equal(session.userId, '123');
    assert.equal(session.username, 'reader');
    assert.equal(storage.size, 0);
    assert.equal(JSON.stringify(session).includes(access), false);
    const result = await session.readLibrary();
    assert.equal(result.books.length, 101);
    assert.equal(result.accountKey, '123');
    assert.equal(result.label, '@reader');
    assert.equal(JSON.stringify(result).includes('hc_'), false);
    assert.equal((calls[2].payload.variables as Record<string, unknown>).after, 100);
    await session.revoke();
    assert.equal(session.expiresAt, 0);
    await assert.rejects(session.readLibrary(), /connection is closed/);
  });
});

test('Hardcover never applies a partial library after an API failure or silently truncates a collection over 2,000 books', async () => {
  await browser(async ({ storage, navigate }) => {
    let tooLarge = false;
    globalThis.fetch = async (input, init = {}) => {
      if (String(input).endsWith('/oauth2/token')) return json(tokens);
      const payload = JSON.parse(String(init.body));
      if (payload.query.includes('CybershelfIdentity')) return json({ data: { me: [{ id: 123, username: 'reader' }] } });
      const after = payload.variables.after;
      if (after > 0 && !tooLarge) return json({ sensitive_error: 'Do not show this account detail.' }, 503);
      return json({ data: { user_books: Array.from({ length: after < 2000 ? 100 : 1 }, (_, i) => row(after + i + 1)) } });
    };
    await beginHardcoverAuthorization(options);
    navigate(callback(storage));
    const session = (await consumeHardcoverAuthorization(options))!;
    await assert.rejects(session.readLibrary(), error => error instanceof Error && /library has not changed/.test(error.message) && !error.message.includes('sensitive'));
    tooLarge = true;
    await assert.rejects(session.readLibrary(), /up to 2,000 books/);
    session.dispose();
  });
});

test('Hardcover rotates refresh credentials once and never retries an ambiguous refresh that could revoke the token chain', async () => {
  await browser(async ({ storage, navigate }) => {
    let refreshes = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        const form = new URLSearchParams(String(init.body));
        if (form.get('grant_type') === 'authorization_code') return json(tokens);
        assert.equal(form.get('refresh_token'), refresh);
        refreshes++;
        throw new Error('Network response lost after provider rotated the token');
      }
      const payload = JSON.parse(String(init.body));
      if (payload.query.includes('CybershelfIdentity')) return json({ data: { me: [{ id: 123, username: 'reader' }] } });
      return json({}, 401);
    };
    await beginHardcoverAuthorization(options);
    navigate(callback(storage));
    const session = (await consumeHardcoverAuthorization(options))!;
    await assert.rejects(session.readLibrary(), /Could not reach Hardcover/);
    await assert.rejects(session.readLibrary(), /connection is closed/);
    assert.equal(refreshes, 1);
    assert.equal(session.expiresAt, 0);
    assert.equal(storage.size, 0);
  });
});

test('Hardcover renews a revoked access token with one rotated refresh and uses the replacement token for API calls and revocation', async () => {
  await browser(async ({ storage, navigate }) => {
    let refreshes = 0, libraryCalls = 0, revokeToken = '';
    const newAccess = 'hc_at_new_access_for_this_test', newRefresh = 'hc_rt_new_refresh_for_this_test';
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        const form = new URLSearchParams(String(init.body));
        if (form.get('grant_type') === 'authorization_code') return json(tokens);
        refreshes++;
        assert.equal(form.get('refresh_token'), refresh);
        return json({ ...tokens, access_token: newAccess, refresh_token: newRefresh });
      }
      if (url.endsWith('/oauth2/revoke')) {
        revokeToken = new URLSearchParams(String(init.body)).get('token') ?? '';
        return new Response(null, { status: 200 });
      }
      const payload = JSON.parse(String(init.body));
      if (payload.query.includes('CybershelfIdentity')) return json({ data: { me: [{ id: 123, username: 'reader' }] } });
      libraryCalls++;
      if (libraryCalls === 1) return json({}, 401);
      assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${newAccess}`);
      return json({ data: { user_books: [row()] } });
    };
    await beginHardcoverAuthorization(options);
    navigate(callback(storage));
    const session = (await consumeHardcoverAuthorization(options))!;
    const result = await session.readLibrary();
    assert.equal(result.books.length, 1);
    assert.equal(refreshes, 1);
    assert.equal(libraryCalls, 2);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(session.readLibrary(cancelled.signal), error => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(libraryCalls, 2);
    await session.revoke();
    assert.equal(revokeToken, newRefresh);
    assert.equal(storage.size, 0);
  });
});

test('Hardcover stops oversized responses while streaming instead of reading an unbounded provider body', async () => {
  await browser(async ({ storage, navigate }) => {
    let cancelled = false;
    globalThis.fetch = async (input, init = {}) => {
      if (String(input).endsWith('/oauth2/token')) return json(tokens);
      const payload = JSON.parse(String(init.body));
      if (payload.query.includes('CybershelfIdentity')) return json({ data: { me: [{ id: 123, username: 'reader' }] } });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(4_000_001)); },
        cancel() { cancelled = true; },
      }));
    };
    await beginHardcoverAuthorization(options);
    navigate(callback(storage));
    const session = (await consumeHardcoverAuthorization(options))!;
    await assert.rejects(session.readLibrary(), /more data than this sync can safely read/);
    assert.equal(cancelled, true);
    session.dispose();
  });
});
