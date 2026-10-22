import type { RemoteBook } from '../connections';
import type { ReadingStatus } from '../types';

/** Provider tokens never leave this browser module. Only the selected, mapped
 * library metadata is returned to the rest of Cybershelf. */
export const HARDCOVER_SCOPES = 'read:catalog:data read:library read:me:content';
const AUTHORIZE_URL = 'https://hardcover.app/oauth2/authorize';
const TOKEN_URL = 'https://api.hardcover.app/oauth2/token';
const REVOKE_URL = 'https://api.hardcover.app/oauth2/revoke';
const GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
const ISSUER = 'https://api.hardcover.app';
const PENDING_KEY = 'cybershelf.hardcover.pending.v1';
const PENDING_LIFETIME = 10 * 60 * 1000;
const LIBRARY_LIMIT = 2000;
const PAGE_SIZE = 100;
const RESPONSE_BYTE_LIMIT = 4_000_000;

export interface HardcoverAuthorizationOptions {
  clientId: string;
  accountId: string;
  redirectUri: string;
}

export interface HardcoverSession {
  readonly userId: string;
  readonly username: string;
  readonly expiresAt: number;
  readLibrary(signal?: AbortSignal): Promise<{ accountKey: string; label: string; books: RemoteBook[] }>;
  /** Revoke at Hardcover and forget this browser's tokens, even if offline. */
  revoke(): Promise<void>;
  /** Forget credentials immediately, e.g. on a Cybershelf account change. */
  dispose(): void;
}

interface PendingAuthorization extends HardcoverAuthorizationOptions {
  state: string;
  verifier: string;
  createdAt: number;
}
interface Tokens { access: string; refresh: string | null; expiresAt: number }
type JsonRecord = Record<string, unknown>;

export class HardcoverConnectionError extends Error {
  constructor(message: string) { super(message); this.name = 'HardcoverConnectionError'; }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
}
function imageUrl(value: unknown): string {
  try {
    const url = new URL(typeof value === 'string' ? value : '');
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}
function abortError(): DOMException { return new DOMException('The Hardcover sync was cancelled.', 'AbortError'); }
function fail(message: string): never { throw new HardcoverConnectionError(message); }
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function randomString(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }

function validateOptions(options: HardcoverAuthorizationOptions): void {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(options.clientId) || !options.accountId || options.accountId.length > 200) {
    fail('Hardcover is not configured for this account. Sign in and try again.');
  }
  let url: URL;
  try { url = new URL(options.redirectUri); } catch { fail('The Hardcover return address is not configured correctly.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== window.location.origin || url.pathname !== '/connect/hardcover' || url.search || url.hash || url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    fail('The Hardcover return address is not configured correctly.');
  }
}

/** Starts the provider's consent screen. The only persisted secret is a short
 * lived PKCE verifier, deleted before it is exchanged for tokens. */
export async function beginHardcoverAuthorization(options: HardcoverAuthorizationOptions): Promise<void> {
  validateOptions(options);
  const state = randomString(), verifier = randomString();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const pending: PendingAuthorization = { ...options, state, verifier, createdAt: Date.now() };
  try { window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); }
  catch { fail('Allow temporary browser storage to connect Hardcover, then try again.'); }
  const params = new URLSearchParams({
    response_type: 'code', client_id: options.clientId, redirect_uri: options.redirectUri,
    state, code_challenge: challenge, code_challenge_method: 'S256', scope: HARDCOVER_SCOPES,
  });
  window.location.assign(`${AUTHORIZE_URL}?${params}`);
}

/** Handles only our dedicated callback. Query parameters are removed before
 * any provider request; state is consumed once even when validation fails. */
export async function consumeHardcoverAuthorization(options: HardcoverAuthorizationOptions): Promise<HardcoverSession | null> {
  const current = new URL(window.location.href);
  if (current.pathname !== '/connect/hardcover' || !['code', 'error', 'state', 'iss'].some(key => current.searchParams.has(key))) return null;
  window.history.replaceState(window.history.state, '', '/connect/hardcover');
  let pending: JsonRecord = {};
  try {
    const saved = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    if (saved && saved.length <= 4096) pending = record(JSON.parse(saved));
  } catch { fail('The connection could not be verified. Please connect Hardcover again.'); }
  validateOptions(options);
  const now = Date.now();
  const valid = typeof pending.state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(pending.state)
    && typeof pending.verifier === 'string' && /^[A-Za-z0-9_-]{43}$/.test(pending.verifier)
    && pending.clientId === options.clientId && pending.accountId === options.accountId
    && pending.redirectUri === options.redirectUri && typeof pending.createdAt === 'number'
    && Number.isFinite(pending.createdAt) && pending.createdAt <= now && now - pending.createdAt <= PENDING_LIFETIME
    && current.searchParams.get('state') === pending.state && current.searchParams.get('iss') === ISSUER;
  if (!valid) fail('This connection expired or belongs to a different sign-in. Please connect Hardcover again.');
  if (current.searchParams.has('error')) fail('Hardcover was not connected. You can try again whenever you are ready.');
  const code = current.searchParams.get('code');
  if (!code || code.length > 2048 || /[\u0000-\u0020\u007f]/.test(code)) fail('The connection could not be verified. Please connect Hardcover again.');
  const payload = await requestJson(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: options.clientId, redirect_uri: options.redirectUri, code_verifier: pending.verifier as string }),
  });
  const tokens = parseTokens(payload);
  const session = new BrowserHardcoverSession(options.clientId, tokens);
  try { await session.identify(); return session; }
  catch (error) { await session.revoke().catch(() => {}); throw error; }
}

class ProviderRequestError extends HardcoverConnectionError {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readResponse(response: Response): Promise<string> {
  const tooLarge = () => fail('Hardcover returned more data than this sync can safely read. Your library has not changed.');
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_BYTE_LIMIT) {
    await response.body?.cancel().catch(() => {});
    tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_BYTE_LIMIT) { await reader.cancel().catch(() => {}); tooLarge(); }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally { reader.releaseLock(); }
}

/** Never echoes provider error bodies: they can contain personal details. */
async function requestJson(url: string, init: RequestInit, signals: (AbortSignal | undefined)[] = []): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signals.some(signal => signal?.aborted)) throw abortError();
  for (const signal of signals) {
    signal?.addEventListener('abort', cancel, { once: true });
  }
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch(url, { ...init, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) {
      if (response.status === 429) throw new ProviderRequestError(429, 'Hardcover has paused requests for a little while. Try syncing again later.');
      if (response.status === 401) throw new ProviderRequestError(401, 'Your Hardcover connection has expired. Connect again to continue syncing.');
      if (response.status === 403) throw new ProviderRequestError(403, 'Hardcover did not allow this request. Reconnect and approve the library permissions.');
      throw new ProviderRequestError(response.status, 'Hardcover could not complete the request. Your library has not changed; try again later.');
    }
    const body = await readResponse(response);
    try { return JSON.parse(body); }
    catch { fail('Hardcover returned an unreadable response. Your library has not changed; try again later.'); }
  } catch (error) {
    if (signals.some(signal => signal?.aborted)) throw abortError();
    if (timedOut) fail('Hardcover took too long to respond. Your library has not changed; try again later.');
    if (error instanceof HardcoverConnectionError) throw error;
    fail('Could not reach Hardcover. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
    for (const signal of signals) signal?.removeEventListener('abort', cancel);
  }
}

function parseTokens(value: unknown): Tokens {
  const data = record(value), seconds = Number(data.expires_in);
  const access = typeof data.access_token === 'string' ? data.access_token : '';
  const refresh = typeof data.refresh_token === 'string' ? data.refresh_token : null;
  if (!/^hc_at_[A-Za-z0-9_-]{10,4000}$/.test(access) || (refresh !== null && !/^hc_rt_[A-Za-z0-9_-]{10,4000}$/.test(refresh))
    || !Number.isFinite(seconds) || seconds <= 0 || seconds > 366 * 86400
    || (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer')) {
    fail('Hardcover returned an invalid connection. Please connect again.');
  }
  if (typeof data.scope === 'string') {
    const granted = new Set(data.scope.split(/\s+/));
    if (!HARDCOVER_SCOPES.split(' ').every(scope => granted.has(scope))) fail('The required Hardcover permissions were not granted. Please connect again.');
  }
  return { access, refresh, expiresAt: Date.now() + seconds * 1000 };
}

const LIBRARY_QUERY = `query CybershelfLibrary($userId: Int!, $after: Int!, $limit: Int!) {
  user_books(where: {user_id: {_eq: $userId}, id: {_gt: $after}, status_id: {_neq: 6}}, order_by: {id: asc}, limit: $limit) {
    id book_id status_id owned rating updated_at
    book { id title slug pages image { url } contributions { contribution author { name } } }
    edition { id title isbn_10 isbn_13 pages image { url } }
    user_book_reads(order_by: {id: desc}, limit: 1) {
      id progress_pages progress_seconds started_at finished_at
      edition { id pages audio_seconds }
    }
  }
}`;

class BrowserHardcoverSession implements HardcoverSession {
  #tokens: Tokens;
  #clientId: string;
  #userId = '';
  #username = '';
  #closed = false;
  #controller = new AbortController();
  #refreshTask: Promise<void> | null = null;

  constructor(clientId: string, tokens: Tokens) { this.#clientId = clientId; this.#tokens = tokens; }
  get userId(): string { return this.#userId; }
  get username(): string { return this.#username; }
  get expiresAt(): number { return this.#tokens.expiresAt; }

  #assertOpen(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError();
    if (this.#closed) fail('Your Hardcover connection is closed. Connect again to continue syncing.');
  }

  async identify(): Promise<void> {
    const data = await this.#graphql('query CybershelfIdentity { me { id username } }');
    const users = data.me;
    const user = Array.isArray(users) && users.length === 1 ? record(users[0]) : {};
    const id = integer(user.id);
    if (!id) fail('Hardcover did not return a usable account. Please reconnect.');
    this.#userId = String(id);
    this.#username = text(user.username, 100);
  }

  async #refresh(): Promise<void> {
    this.#assertOpen();
    if (this.#refreshTask) return this.#refreshTask;
    const refreshToken = this.#tokens.refresh;
    if (!refreshToken) { this.dispose(); fail('Your Hardcover connection has expired. Connect again to continue syncing.'); }
    // Rotation is one-use. Never retry an ambiguous refresh response with the
    // same credential: that would revoke the provider's entire token chain.
    this.#tokens.refresh = null;
    this.#refreshTask = (async () => {
      try {
        const payload = await requestJson(TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: this.#clientId, refresh_token: refreshToken }),
        }, [this.#controller.signal]);
        this.#assertOpen();
        this.#tokens = parseTokens(payload);
      } catch (error) { this.dispose(); throw error; }
      finally { this.#refreshTask = null; }
    })();
    return this.#refreshTask;
  }

  async #graphql(query: string, variables?: Record<string, unknown>, signal?: AbortSignal): Promise<JsonRecord> {
    this.#assertOpen(signal);
    if (this.#tokens.expiresAt <= Date.now() + 60000) await this.#refresh();
    const makeRequest = () => {
      this.#assertOpen(signal);
      return requestJson(GRAPHQL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#tokens.access}` },
        body: JSON.stringify({ query, variables }),
      }, [this.#controller.signal, signal]);
    };
    let payload: unknown;
    try { payload = await makeRequest(); }
    catch (error) {
      if (!(error instanceof ProviderRequestError) || error.status !== 401) throw error;
      await this.#refresh();
      payload = await makeRequest();
    }
    this.#assertOpen(signal);
    const response = record(payload);
    if (Array.isArray(response.errors) && response.errors.length || !response.data || typeof response.data !== 'object') {
      fail('Hardcover could not read the requested library data. Your library has not changed. Try reconnecting.');
    }
    return record(response.data);
  }

  async readLibrary(signal?: AbortSignal): Promise<{ accountKey: string; label: string; books: RemoteBook[] }> {
    this.#assertOpen(signal);
    if (!this.#userId) fail('Your Hardcover account is not ready. Please reconnect.');
    const books: RemoteBook[] = [];
    let after = 0, count = 0;
    while (true) {
      const data = await this.#graphql(LIBRARY_QUERY, { userId: Number(this.#userId), after, limit: PAGE_SIZE }, signal);
      if (!Array.isArray(data.user_books) || data.user_books.length > PAGE_SIZE) fail('Hardcover returned an incomplete library. Your library has not changed.');
      const page = data.user_books;
      count += page.length;
      if (count > LIBRARY_LIMIT) fail('This connection currently supports up to 2,000 books. Your library has not changed; use an export for a larger collection.');
      for (const raw of page) {
        const row = record(raw), id = integer(row.id);
        if (!id || id <= after) fail('Hardcover returned an inconsistent library. Your library has not changed; try again later.');
        after = id;
        const book = mapHardcoverBook(row);
        if (book) books.push(book);
      }
      if (page.length < PAGE_SIZE) break;
    }
    this.#assertOpen(signal);
    return { accountKey: this.#userId, label: this.#username ? `@${this.#username}` : 'Hardcover', books };
  }

  dispose(): void {
    this.#closed = true;
    this.#tokens = { access: '', refresh: null, expiresAt: 0 };
    this.#controller.abort();
  }

  async revoke(): Promise<void> {
    const token = this.#tokens.refresh || this.#tokens.access;
    const tokenHint = this.#tokens.refresh ? 'refresh_token' : 'access_token';
    this.dispose();
    if (!token) return;
    // Revocation often returns an empty 200 response, unlike the JSON API.
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(REVOKE_URL, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, token_type_hint: tokenHint, client_id: this.#clientId }),
      });
      if (!response.ok) throw new Error('revoke_failed');
    } catch { fail('Disconnected on this device. To revoke access at Hardcover too, open Hardcover’s Authorized Apps settings.'); }
    finally { clearTimeout(timeout); }
  }
}

/** Pure mapping deliberately excludes private notes, reviews, email, and raw
 * account responses. A marked-owned book is not proof of a retailer purchase. */
export function mapHardcoverBook(value: unknown): RemoteBook | null {
  const row = record(value), id = integer(row.id);
  if (!id || row.status_id === 6) return null;
  const catalog = record(row.book), edition = record(row.edition);
  const title = text(edition.title, 300) || text(catalog.title, 300);
  if (!title) fail('A Hardcover book is missing its title. Your library has not changed.');
  const contributions = Array.isArray(catalog.contributions) ? catalog.contributions.map(record) : [];
  const authors = contributions.filter(item => !item.contribution || /^author$/i.test(String(item.contribution)));
  const names = (authors.length ? authors : contributions).map(item => text(record(item.author).name, 200)).filter(Boolean);
  const author = [...new Set(names)].join(', ').slice(0, 500) || 'Unknown author';
  const slug = text(catalog.slug, 300);
  const isbnValue = text(edition.isbn_13, 30) || text(edition.isbn_10, 30);
  const isbn = isbnValue.replace(/[-\s]/g, '');
  const pages = integer(edition.pages) || integer(catalog.pages);
  const statusMap: Record<number, ReadingStatus> = { 1: 'unread', 2: 'reading', 3: 'read', 4: 'paused', 5: 'dnf' };
  const status = typeof row.status_id === 'number' ? statusMap[row.status_id] : undefined;
  const read = record(Array.isArray(row.user_book_reads) ? row.user_book_reads[0] : undefined);
  const readEdition = record(read.edition);
  const readPages = integer(readEdition.pages), progressPages = integer(read.progress_pages);
  const totalSeconds = integer(readEdition.audio_seconds), progressSeconds = integer(read.progress_seconds);
  let progress: number | undefined;
  if (status === 'read') progress = 100;
  else if (status === 'unread') progress = 0;
  else if (!read.finished_at) {
    if (readPages && progressPages !== undefined && progressPages <= readPages) progress = Math.floor(progressPages / readPages * 100);
    else if (totalSeconds && progressSeconds !== undefined && progressSeconds <= totalSeconds) progress = Math.floor(progressSeconds / totalSeconds * 100);
  }
  const rating = typeof row.rating === 'number' && Number.isFinite(row.rating) && row.rating >= 0 && row.rating <= 5 ? row.rating : undefined;
  const updatedAt = typeof row.updated_at === 'string' && row.updated_at.length <= 40 && Number.isFinite(Date.parse(row.updated_at)) ? new Date(row.updated_at).toISOString() : undefined;
  return {
    remoteId: String(id), title, author, coverUrl: imageUrl(record(edition.image).url) || imageUrl(record(catalog.image).url),
    url: /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) ? `https://hardcover.app/books/${slug}` : 'https://hardcover.app',
    ...(/^(?:\d{13}|\d{9}[\dXx])$/.test(isbn) ? { isbn: isbn.toUpperCase() } : {}),
    ...(pages && pages <= 50000 ? { pages } : {}), ...(typeof row.owned === 'boolean' ? { owned: row.owned } : {}),
    ...(status ? { status } : {}), ...(progress !== undefined ? { progress } : {}),
    ...(rating !== undefined ? { rating } : {}), ...(updatedAt ? { updatedAt } : {}),
  };
}
