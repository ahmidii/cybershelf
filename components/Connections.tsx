'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, FileSpreadsheet, Link2, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Unplug, Upload } from 'lucide-react';
import type { AppState } from '@/lib/types';
import type { AccountConnectionsController, PendingConnection } from '@/lib/use-connections';
import { syncConnection } from '@/lib/connections';
import { signInPath } from '@/lib/auth-contract';
import styles from './Connections.module.css';

interface Props {
  state: AppState; accountId: string | null; ready: boolean;
  controller: AccountConnectionsController;
  onImport: () => void; onAddFiles: () => void;
}

function PendingImport({ candidate, state, ready, controller }: { candidate: PendingConnection; state: AppState; ready: boolean; controller: AccountConnectionsController }) {
  const [label, setLabel] = useState(candidate.connection.label);
  const [autoSync, setAutoSync] = useState(candidate.connection.autoSync);
  const [syncProgress, setSyncProgress] = useState(candidate.connection.syncProgress);
  const preview = useMemo(() => {
    try { return { summary: syncConnection(state, { ...candidate.connection, autoSync, syncProgress }, candidate.books).summary, error: '' }; }
    catch (error) { return { summary: undefined, error: error instanceof Error ? error.message : 'This library could not be imported.' }; }
  }, [state, candidate, autoSync, syncProgress]);
  return <section className={styles.preview} aria-label="Review your connected library">
    <div className={styles.cardHeading}><span className={styles.serviceMark}>h.</span><div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Your books found their way.</h2><p>{candidate.username ? `Connected to @${candidate.username} on Hardcover.` : 'Hardcover has authorized this browser.'}</p></div></div>
    <div className={styles.stats}><span><strong>{candidate.books.length}</strong> books found</span><span><strong>{preview.summary?.added ?? '—'}</strong> new to your library</span><span><strong>{preview.summary?.updated ?? '—'}</strong> to refresh</span></div>
    <label className="field">A name for this connection<input maxLength={80} disabled={!ready || !!controller.busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="Hardcover" /></label>
    <div className={styles.preferences}>
      <label><input type="checkbox" disabled={!ready || !!controller.busy} checked={autoSync} onChange={event => setAutoSync(event.target.checked)} /><span><strong>Keep up while I’m here</strong><small>Check for changes every five minutes while Cybershelf is open and visible.</small></span></label>
      <label><input type="checkbox" disabled={!ready || !!controller.busy} checked={syncProgress} onChange={event => setSyncProgress(event.target.checked)} /><span><strong>Bring my reading progress, too</strong><small>Import status and available progress. This can reveal later thoughts in Reading together. Bookmarks you changed here are kept.</small></span></label>
    </div>
    <p className={styles.finePrint}>Titles, authors, editions, covers, ratings, and links join your private library. Notes and journal entries stay on Hardcover. Nothing is posted for you, and Cybershelf does not change your Hardcover account.</p>
    {preview.summary?.preserved ? <p className={styles.preserved}><ShieldCheck size={15} />Your edits are kept on {preview.summary.preserved} {preview.summary.preserved === 1 ? 'book' : 'books'}.</p> : null}
    {preview.error ? <p className="notice error" role="alert">{preview.error}</p> : null}
    <div className={styles.actions}><button className="button primary" disabled={!ready || !!controller.busy || !!preview.error} onClick={() => void controller.accept({ label, autoSync, syncProgress })}>{controller.busy === 'import' ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Add & connect</button><button className="button quiet" disabled={!!controller.busy} onClick={() => void controller.discard()}>Cancel connection</button></div>
  </section>;
}

function syncedDate(value?: string) {
  if (!value) return 'Not synced yet';
  return 'Last synced ' + new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Connections({ state, accountId, ready, controller, onImport, onAddFiles }: Props) {
  const available = controller.config?.hardcover.available;
  const canManage = ready && !!accountId;
  return <section className={styles.page} aria-label="Book account connections">
    <header className="page-heading"><div><p className="eyebrow">YOUR BOOKS, CLOSER TOGETHER</p><h1>Connections<span className="title-period">.</span></h1><p className="page-description">Bring your reading life into one place, with a clear view of what comes along.</p></div></header>
    <div className={styles.promise}><LockKeyhole size={23} strokeWidth={1.4} /><div><strong>Your provider login stays with you.</strong><p>You authorize Hardcover directly. Its access tokens stay in this browser’s memory; closing or reloading the page ends this sync session. {accountId ? 'Your imported library is saved privately to your Cybershelf account.' : 'File imports stay in this browser until you sign in and save them.'}</p><p className={styles.privacyBoundary}>Catalog data saved to your Cybershelf account is not end-to-end encrypted; the operator can access it. Cybershelf never asks for your provider’s password.</p></div></div>
    {controller.error ? <p className="notice error" role="alert">{controller.error}</p> : null}
    {controller.configError && accountId ? <div className="notice error" role="alert"><p>{controller.configError}</p><button className="text-button" onClick={() => void controller.loadConfig()}>Try again</button></div> : null}
    {controller.pending ? <PendingImport key={controller.pending.connection.id} candidate={controller.pending} state={state} ready={canManage} controller={controller} /> : null}
    {!!state.connections?.length && <section className={styles.connected} aria-label="Your connected accounts">
      <div className={styles.sectionTitle}><h2>Within reach</h2><span>{state.connections.length} {state.connections.length === 1 ? 'account' : 'accounts'}</span></div>
      {state.connections.map(connection => {
        const active = controller.activeIds.includes(connection.id);
        const linked = state.books.filter(book => book.connections?.some(link => link.connectionId === connection.id)).length;
        return <article className={styles.connectedCard} key={connection.id}>
          <div className={styles.connectedHeading}><span className={styles.serviceMark}>h.</span><div><h3>{connection.label}</h3><p>{linked} books linked · {syncedDate(connection.lastSyncedAt)}</p></div><span className={styles.sessionState}><i className={active ? styles.activeDot : ''} />{active ? ready ? 'Connected this visit' : 'Sync paused' : accountId ? 'Reconnect to refresh' : 'Sign in to reconnect'}</span></div>
          {connection.lastSummary ? <p className={styles.lastSync}>{connection.lastSummary.added} added · {connection.lastSummary.updated} updated{connection.lastSummary.preserved ? ` · edits kept on ${connection.lastSummary.preserved} books` : ''}</p> : null}
          <div className={styles.preferences}>
            <label><input type="checkbox" checked={connection.autoSync} disabled={!canManage || !!controller.busy} onChange={event => void controller.preference(connection.id, { autoSync: event.target.checked })} /><span>Refresh automatically while I’m here</span></label>
            <label><input type="checkbox" checked={connection.syncProgress} disabled={!canManage || !!controller.busy} onChange={event => void controller.preference(connection.id, { syncProgress: event.target.checked })} /><span>Sync reading progress <small>May reveal later thoughts. Your own bookmark changes are kept.</small></span></label>
          </div>
          <div className={styles.actions}><button className="button secondary" disabled={!canManage || !!controller.busy || !available} onClick={() => void (active ? controller.sync(connection.id) : controller.connect())}>{controller.busy === connection.id ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{active ? 'Sync now' : 'Reconnect Hardcover'}</button><button className="text-button" disabled={!canManage || !!controller.busy} onClick={() => void controller.disconnect(connection.id)}><Unplug size={14} />Disconnect</button><span className={styles.keepBooks}>Your books stay in your library.</span></div>
        </article>;
      })}
    </section>}
    <div className={styles.services}>
      <article className={styles.serviceCard}>
        <div className={styles.cardHeading}><span className={styles.serviceMark}>h.</span><div><h2>Hardcover</h2><span className={styles.tag}>Account sync · read access</span></div></div>
        <p>Bring over your book collection and keep its details current. Add reading progress when you want your bookmark to follow along.</p>
        <ul className={styles.featureList}><li><Check size={14} />Titles, covers, editions & ratings</li><li><Check size={14} />Optional reading progress</li><li><Check size={14} />Your edits and journal stay yours</li></ul>
        {!accountId ? <a className="button primary" href={signInPath('/connect/hardcover')}>Sign in to connect<ArrowUpRight size={15} /></a> : available ? <button className="button primary" disabled={!ready || !!controller.busy || !!controller.pending} onClick={() => void controller.connect()}>{controller.busy === 'connect' || controller.busy === 'authorize' ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}{controller.busy === 'authorize' ? 'Finding your books…' : 'Connect Hardcover'}</button> : <div className={styles.unavailable}><span>{controller.config ? 'Hardcover is not available here yet.' : controller.configError ? 'Connection settings unavailable.' : 'Checking connection availability…'}</span><small>You can bring in a library file below while account authorization is unavailable.</small></div>}
        <p className={styles.finePrint}>Approve access on Hardcover. No password or API key to paste.</p>
      </article>
      <article className={styles.serviceCard}>
        <div className={styles.cardHeading}><span className={styles.importMark}><FileSpreadsheet size={25} strokeWidth={1.3} /></span><div><h2>Goodreads & CSV</h2><span className={styles.tag}>File import</span></div></div>
        <p>A simple way to bring an existing reading life with you: export your Goodreads library, then choose the file here.</p>
        <ul className={styles.featureList}><li><Check size={14} />Books, ratings & reading history</li><li><Check size={14} />Preview before adding</li><li><Check size={14} />Existing records are kept</li></ul>
        <button className="button secondary" onClick={onImport} disabled={!ready}><Upload size={16} />Import a library</button>
        <p className={styles.finePrint}>A snapshot from a file. Changes on Goodreads do not sync automatically.</p>
      </article>
    </div>
    <div className={styles.fileNote}><BookOpen size={25} strokeWidth={1.3} /><div><h2>Books live in lots of places.</h2><p>EPUBs and PDFs can join your library, too. For Kindle, Kobo, Apple Books, and other stores, add a source link to each book so you can find it again.</p></div><button className="text-button" onClick={onAddFiles} disabled={!ready}>Add EPUB or PDF<ArrowRight size={15} /></button></div>
    <details className={styles.explainer}><summary>What syncing means here<ChevronDown size={16} /></summary><div>
      <h3>A connection has a direction.</h3><p>This release reads from Hardcover into Cybershelf. It does not write changes back, synchronize retailer purchases, or transfer protected ebooks. A book marked “owned” on Hardcover is that reader’s own record.</p>
      <h3>Sync follows your visit.</h3><p>Automatic checks run every five minutes while this tab is visible. Reconnect after a reload or a new visit. Choosing Disconnect forgets the browser’s tokens and requests revocation when they are available. You can always manage access in <a href="https://hardcover.app/account/api/authorized-apps" target="_blank" rel="noreferrer">Hardcover’s authorized apps<ArrowUpRight size={12} /></a>.</p>
      <h3>Private is not the same as encrypted from the operator.</h3><p>Provider tokens are never sent to Cybershelf’s server or saved in backups. Imported book metadata, connection labels, and progress are stored by Cybershelf to run your library. The operator can access that stored data; it is not end-to-end encrypted. Only thoughts and shelves you explicitly share become public.</p>
    </div></details>
  </section>;
}
