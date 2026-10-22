'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, LibraryConnection } from './types';
import { uid } from './types';
import { ACCOUNT_ID_HEADER } from './auth-contract';
import { connectionAccountKey, disconnectConnection, syncConnection, type RemoteBook, type SyncSummary } from './connections';
import { beginHardcoverAuthorization, consumeHardcoverAuthorization, type HardcoverSession } from './connections/hardcover';

interface Props {
  state: AppState; update: (updater: (state: AppState) => AppState) => void;
  accountId: string | null; ready: boolean; flush: () => Promise<void>;
  notify: (message: string) => void;
}
interface Configuration { hardcover: { available: boolean; clientId?: string }; }
export interface PendingConnection { connection: LibraryConnection; books: RemoteBook[]; username: string; }

const message = (error: unknown) => error instanceof Error ? error.message : 'This account could not be synced. Please try again.';

/** Provider sessions live above the views so changing pages does not interrupt
 * sync. None of these objects enter useLibrary, localStorage, or our API. */
export function useAccountConnections(props: Props) {
  const latest = useRef(props); latest.current = props;
  const sessions = useRef(new Map<string, HardcoverSession>());
  const sessionsAccount = useRef<string | null>(null);
  const pendingSession = useRef<HardcoverSession | null>(null);
  const pendingCandidate = useRef<PendingConnection | null>(null);
  const pendingAccount = useRef<string | null>(null);
  const generation = useRef(0), busyRef = useRef(false), callbackStarted = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const lastAttempt = useRef(new Map<string, number>());
  const [config, setConfig] = useState<Configuration | null>(null);
  const [configError, setConfigError] = useState('');
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const isCurrent = useCallback((serial: number, accountId: string) => serial === generation.current && latest.current.accountId === accountId, []);

  const reset = useCallback(() => {
    generation.current++; activeRequest.current?.abort(); activeRequest.current = null;
    for (const session of sessions.current.values()) session.dispose();
    sessions.current.clear(); sessionsAccount.current = null;
    pendingSession.current?.dispose(); pendingSession.current = null; pendingCandidate.current = null; pendingAccount.current = null;
    lastAttempt.current.clear();
    busyRef.current = false; setBusy(''); setPending(null); setActiveIds([]);
  }, []);
  const configuration = useCallback(async (accountId: string, signal?: AbortSignal) => {
    const response = await fetch('/api/connections/config', { headers: { [ACCOUNT_ID_HEADER]: accountId }, credentials: 'same-origin', cache: 'no-store', signal: signal ?? AbortSignal.timeout(15000) });
    const result = await response.json() as Configuration & { error?: string };
    if (latest.current.accountId !== accountId) throw new Error('Your account changed. Reconnect from the current account.');
    if (!response.ok) {
      if (response.status === 401 || response.status === 409) {
        reset(); setError(result.error || 'Your account changed. Sign in again before connecting a book account.');
      }
      throw new Error(result.error || 'Your account connection settings could not be loaded.');
    }
    return result;
  }, [reset]);

  const loadConfig = useCallback(async () => {
    const accountId = latest.current.accountId;
    if (!accountId) return;
    setConfigError('');
    try {
      const result = await configuration(accountId);
      if (latest.current.accountId === accountId) setConfig(result);
    } catch (reason) { if (latest.current.accountId === accountId) setConfigError(message(reason)); }
  }, [configuration]);

  useEffect(() => {
    setConfig(null); setConfigError(''); setError(''); callbackStarted.current = false;
    void loadConfig();
    if (!props.accountId && window.location.pathname === '/connect/hardcover') {
      window.history.replaceState(window.history.state, '', '/connect/hardcover');
      setError('Sign in to Cybershelf, then connect Hardcover again.');
    }
    return reset;
  }, [props.accountId, loadConfig, reset]);

  useEffect(() => {
    if (!props.ready || !props.accountId || !config || callbackStarted.current || window.location.pathname !== '/connect/hardcover') return;
    if (!window.location.search) return;
    callbackStarted.current = true;
    if (!config.hardcover.available || !config.hardcover.clientId) {
      window.history.replaceState(window.history.state, '', '/connect/hardcover');
      setError('Hardcover connections are not available on this installation yet.'); return;
    }
    const accountId = props.accountId, serial = generation.current;
    const controller = new AbortController(); activeRequest.current = controller;
    busyRef.current = true; setBusy('authorize'); setError('');
    void (async () => {
      let session: HardcoverSession | null = null;
      try {
        session = await consumeHardcoverAuthorization({ clientId: config.hardcover.clientId!, accountId, redirectUri: window.location.origin + '/connect/hardcover' });
        if (!session) return;
        if (!isCurrent(serial, accountId) || !latest.current.ready) { session.dispose(); return; }
        const library = await session.readLibrary(controller.signal);
        const accountKey = await connectionAccountKey(accountId, library.accountKey);
        if (!isCurrent(serial, accountId) || !latest.current.ready) { session.dispose(); return; }
        const existing = latest.current.state.connections?.find(connection => connection.accountKey === accountKey);
        const connection: LibraryConnection = existing ?? { id: uid('cx_'), provider: 'hardcover', accountKey, label: 'Hardcover', autoSync: true, syncProgress: false, connectedAt: new Date().toISOString() };
        pendingSession.current?.dispose(); pendingSession.current = session;
        pendingAccount.current = accountId;
        pendingCandidate.current = { connection, books: library.books, username: session.username };
        setPending(pendingCandidate.current);
      } catch (reason) {
        session?.dispose();
        if (isCurrent(serial, accountId) && !controller.signal.aborted) setError(message(reason));
      } finally {
        if (isCurrent(serial, accountId)) { busyRef.current = false; setBusy(''); activeRequest.current = null; }
      }
    })();
  }, [props.ready, props.accountId, config, isCurrent]);

  useEffect(() => {
    if (!props.ready) return;
    const ids = new Set(props.state.connections?.map(connection => connection.id));
    let changed = false;
    for (const [id, session] of sessions.current) if (!ids.has(id)) { session.dispose(); sessions.current.delete(id); changed = true; }
    if (changed) setActiveIds([...sessions.current.keys()]);
  }, [props.state.connections, props.ready]);

  const connect = async () => {
    const { accountId, ready, flush } = latest.current;
    if (!accountId || !ready || busyRef.current) return;
    const serial = generation.current; busyRef.current = true; setBusy('connect'); setError('');
    try {
      await flush();
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      const settings = await configuration(accountId);
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      if (!settings.hardcover.available || !settings.hardcover.clientId) throw new Error('Hardcover connections are not available on this installation yet.');
      await beginHardcoverAuthorization({ clientId: settings.hardcover.clientId, accountId, redirectUri: window.location.origin + '/connect/hardcover' });
    } catch (reason) { if (isCurrent(serial, accountId)) setError(message(reason)); }
    finally { if (isCurrent(serial, accountId)) { busyRef.current = false; setBusy(''); } }
  };

  const accept = async (options: { label: string; autoSync: boolean; syncProgress: boolean }) => {
    const session = pendingSession.current, candidate = pendingCandidate.current, { accountId, ready } = latest.current;
    if (!session || !candidate || !accountId || pendingAccount.current !== accountId || !ready || busyRef.current) return;
    const serial = generation.current; busyRef.current = true; setBusy('import'); setError('');
    try {
      await configuration(accountId);
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      const connection = { ...candidate.connection, ...options, label: options.label.trim().slice(0, 80) || 'Hardcover' };
      let summary: SyncSummary | undefined;
      latest.current.update(current => { const result = syncConnection(current, connection, candidate.books); summary = result.summary; return result.state; });
      if (!summary) throw new Error('Your library is not ready. Wait for it to finish loading, then try again.');
      await latest.current.flush();
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      sessions.current.get(connection.id)?.dispose(); sessions.current.set(connection.id, session);
      sessionsAccount.current = accountId;
      pendingSession.current = null; pendingCandidate.current = null; pendingAccount.current = null; setPending(null); setActiveIds([...sessions.current.keys()]);
      lastAttempt.current.set(connection.id, Date.now());
      latest.current.notify(`${summary?.added ?? 0} books added. Your Hardcover library is connected for this visit.`);
    } catch (reason) { if (isCurrent(serial, accountId)) setError(message(reason)); }
    finally { if (isCurrent(serial, accountId)) { busyRef.current = false; setBusy(''); } }
  };

  const sync = useCallback(async (id: string, quiet = false) => {
    const { accountId, ready } = latest.current;
    const session = sessions.current.get(id);
    if (!accountId || sessionsAccount.current !== accountId || !ready || !session || busyRef.current) return;
    const serial = generation.current, controller = new AbortController();
    activeRequest.current = controller; busyRef.current = true; setBusy(id); setError(''); lastAttempt.current.set(id, Date.now());
    try {
      await configuration(accountId, controller.signal);
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      const library = await session.readLibrary(controller.signal);
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      const fingerprint = await connectionAccountKey(accountId, library.accountKey);
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      let summary: SyncSummary | undefined;
      latest.current.update(current => {
        const connection = current.connections?.find(item => item.id === id);
        if (!connection || connection.accountKey !== fingerprint) throw new Error('This provider account changed. Reconnect it before syncing.');
        const result = syncConnection(current, connection, library.books);
        summary = result.summary; return result.state;
      });
      if (!summary) throw new Error('Your library is not ready. Wait for it to finish loading, then try again.');
      await latest.current.flush();
      if (isCurrent(serial, accountId) && !quiet) latest.current.notify(`${summary.added} added · ${summary.updated} updated. Your edits were kept.`);
    } catch (reason) {
      if (isCurrent(serial, accountId) && !controller.signal.aborted) {
        if (!session.expiresAt && sessions.current.get(id) === session) {
          sessions.current.delete(id); setActiveIds([...sessions.current.keys()]);
        }
        setError(message(reason));
      }
    } finally {
      if (isCurrent(serial, accountId)) { busyRef.current = false; setBusy(''); activeRequest.current = null; }
    }
  }, [configuration, isCurrent]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || busyRef.current || !latest.current.ready) return;
      const due = latest.current.state.connections?.find(connection => connection.autoSync && sessions.current.has(connection.id) && Date.now() - (lastAttempt.current.get(connection.id) ?? 0) >= 5 * 60 * 1000);
      if (due) void sync(due.id, true);
    };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [sync]);

  const discard = async () => {
    if (busyRef.current || pendingAccount.current !== latest.current.accountId) return;
    const serial = generation.current, accountId = latest.current.accountId;
    const session = pendingSession.current; pendingSession.current = null; pendingCandidate.current = null; pendingAccount.current = null; setPending(null); setError('');
    if (session) try { await session.revoke(); } catch {
      if (accountId && isCurrent(serial, accountId)) setError('Forgotten in this browser. To finish revoking access, open your authorized apps on Hardcover.');
    }
  };
  const disconnect = async (id: string) => {
    const { ready, accountId } = latest.current;
    if (!ready || !accountId || busyRef.current || sessions.current.has(id) && sessionsAccount.current !== accountId) return;
    const serial = generation.current; busyRef.current = true; setBusy(id); setError('');
    try {
      const session = sessions.current.get(id); sessions.current.delete(id); setActiveIds([...sessions.current.keys()]);
      let revocationFailed = false;
      if (session) try { await session.revoke(); } catch { revocationFailed = true; }
      if (!isCurrent(serial, accountId) || !latest.current.ready) return;
      latest.current.update(current => disconnectConnection(current, id)); await latest.current.flush();
      if (!isCurrent(serial, accountId)) return;
      latest.current.notify('Disconnected. Your books, files, and journal are still here.');
      if (!session || revocationFailed) setError('Removed from Cybershelf. You can also revoke the grant in Hardcover’s authorized apps.');
    } catch (reason) { if (isCurrent(serial, accountId)) setError(message(reason)); }
    finally { if (isCurrent(serial, accountId)) { busyRef.current = false; setBusy(''); } }
  };
  const preference = async (id: string, patch: Partial<Pick<LibraryConnection, 'autoSync' | 'syncProgress' | 'label'>>) => {
    const { accountId, ready } = latest.current, serial = generation.current;
    if (!accountId || !ready || busyRef.current) return;
    const change = { ...(patch.autoSync === undefined ? {} : { autoSync: patch.autoSync }), ...(patch.syncProgress === undefined ? {} : { syncProgress: patch.syncProgress }), ...(patch.label === undefined ? {} : { label: patch.label.trim().slice(0, 80) || 'Hardcover' }) };
    latest.current.update(current => ({ ...current, connections: current.connections?.map(connection => connection.id === id ? { ...connection, ...change } : connection) }));
    try { await latest.current.flush(); } catch (reason) { if (isCurrent(serial, accountId)) setError(message(reason)); }
  };
  return { config, configError, loadConfig, pending, activeIds, busy, error, connect, accept, sync, disconnect, discard, preference, reset };
}

export type AccountConnectionsController = ReturnType<typeof useAccountConnections>;
