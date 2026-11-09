#!/usr/bin/env node
/** Read-only production metadata audit. Never print captured Wrangler output.
 * Intentionally excludes Worker /settings (bindings), SQL queries, object reads,
 * exports, token retrieval, restores, and all provider mutation commands. */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ORIGIN = 'https://api.cloudflare.com';
const MAX_RESPONSE = 256 * 1024;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const unknown = () => ({ status: 'unknown', confirmed: null });
const observed = value => typeof value === 'boolean' ? { status: value ? 'verified' : 'attention', confirmed: value } : unknown();
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A failed CLI response is not evidence, even if its error mentions success. */
export function privateCommandJson(response) {
  if (response?.status !== 0 || typeof response.stdout !== 'string') return null;
  try { return JSON.parse(response.stdout); } catch { return null; }
}

export function parseManagedDomainPrivacy(response) {
  if (response?.status !== 0 || typeof response.stdout !== 'string') return undefined;
  const lines = response.stdout.split(/\r?\n/).map(line => line.trim());
  const disabled = lines.includes('Public access via the r2.dev URL is disabled.');
  const enabled = lines.some(line => /^Public access is enabled at 'https:\/\/[^'\s]+'\.$/.test(line));
  return disabled === enabled ? undefined : disabled;
}

export function parseCustomDomainPrivacy(response) {
  if (response?.status !== 0 || typeof response.stdout !== 'string') return undefined;
  const lines = response.stdout.split(/\r?\n/).map(line => line.trim());
  const empty = lines.includes('There are no custom domains connected to this bucket.');
  const domains = lines.filter(line => /^domain:\s+\S+$/.test(line));
  const enabled = lines.filter(line => /^enabled:\s+(Yes|No)$/.test(line));
  if (empty && domains.length === 0 && enabled.length === 0) return true;
  if (empty || domains.length === 0 || domains.length !== enabled.length) return undefined;
  return enabled.every(line => /^enabled:\s+No$/.test(line));
}

export function parseBackupRetention(response) {
  if (response?.status !== 0 || typeof response.stdout !== 'string') return undefined;
  const lines = response.stdout.split(/\r?\n/).map(line => line.trim());
  if (lines.some(line => /^There are no lifecycle rules for bucket '[^']+'\.$/.test(line))) return false;
  const rules = [];
  let rule;
  for (const line of lines) {
    const field = /^(name|enabled|prefix|action):\s+(.+)$/.exec(line);
    if (!field) continue;
    if (field[1] === 'name') { rule = {}; rules.push(rule); }
    if (rule) rule[field[1]] = field[2];
  }
  if (!rules.length || rules.some(item => !item.name || !['Yes', 'No'].includes(item.enabled) || !item.prefix || !item.action)) return undefined;
  return rules.some(item => {
    const age = /(?:^|, )Expire objects after (\d+(?:\.\d+)?) days(?:, |$)/.exec(item.action);
    return item.enabled === 'Yes' && item.prefix === '(all prefixes)' && age && Number(age[1]) > 0 && Number(age[1]) <= 30;
  });
}

function apiResult(response) {
  return response?.ok === true && response.status === 200 && response.body?.success === true
    && isRecord(response.body.result) ? response.body.result : null;
}

function healthResult(response) {
  return response?.ok === true && response.status === 200 && isRecord(response.body)
    ? (isRecord(response.body.operations) ? response.body.operations : response.body) : null;
}

/** Only allowlisted booleans/statuses leave this function. Raw metadata may
 * contain account names, bookmarks or provider diagnostics; none are returned. */
export function summarizeOperationsEvidence(evidence, expected = {}) {
  const who = privateCommandJson(evidence.whoami);
  const info = privateCommandJson(evidence.d1Info);
  const travel = privateCommandJson(evidence.timeTravel);
  const health = healthResult(evidence.health);
  const settings = apiResult(evidence.scriptSettings);
  const account = apiResult(evidence.account);
  const schedule = apiResult(evidence.schedules);
  const secrets = privateCommandJson(evidence.secretNames);
  const databaseMatches = isRecord(info) && typeof expected.databaseId === 'string'
    && info.uuid === expected.databaseId && info.name === expected.databaseName;
  const bookmarkReturned = isRecord(travel) && typeof travel.bookmark === 'string'
    && /^[A-Za-z0-9:_-]{8,256}$/.test(travel.bookmark);
  const validSchedule = Array.isArray(schedule?.schedules)
    && schedule.schedules.every(item => isRecord(item) && typeof item.cron === 'string' && item.cron.length > 0);
  const crons = validSchedule ? schedule.schedules.map(item => item.cron) : null;
  const expectedCrons = Array.isArray(expected.crons) ? expected.crons : [];
  const logging = settings?.observability;
  const logEnabled = typeof logging?.logs?.enabled === 'boolean' ? logging.logs.enabled : undefined;
  const logPersisted = typeof logging?.logs?.persist === 'boolean' ? logging.logs.persist : undefined;
  const moderatorSecret = Array.isArray(secrets) && secrets.every(item => isRecord(item) && typeof item.name === 'string' && typeof item.type === 'string')
    ? secrets.some(item => item.name === 'MODERATOR_USER_IDS' && item.type === 'secret_text') : undefined;
  const backupConfigured = typeof health?.backupConfigured === 'boolean' ? health.backupConfigured : undefined;
  const backupRecent = typeof health?.backupRecent === 'boolean' ? health.backupRecent : undefined;
  const backupManaged = parseManagedDomainPrivacy(evidence.backupManagedDomain);
  const backupCustom = parseCustomDomainPrivacy(evidence.backupCustomDomains);
  const checks = {
    cloudflareAuthentication: observed(isRecord(who) && typeof who.loggedIn === 'boolean' ? who.loggedIn : undefined),
    expectedD1Database: observed(isRecord(info) && typeof info.uuid === 'string' && typeof info.name === 'string' ? databaseMatches : undefined),
    d1ProductionTimeTravel: observed(info?.version === 'alpha' ? false : databaseMatches && bookmarkReturned ? true : undefined),
    d1RetentionWindowReviewed: unknown(),
    r2ManagedDomainPrivate: observed(parseManagedDomainPrivacy(evidence.managedDomain)),
    r2CustomDomainsPrivate: observed(parseCustomDomainPrivacy(evidence.customDomains)),
    maintenanceSchedule: observed(crons ? crons.length > 0 && expectedCrons.every(cron => crons.includes(cron)) : undefined),
    workerLogsEnabled: observed(logging?.enabled === false ? false : logEnabled),
    workerLogsPersisted: observed(logEnabled === false || logPersisted === false ? false : logEnabled === true && logPersisted === true ? true : undefined),
    workerInvocationLogsDisabled: observed(typeof logging?.logs?.invocation_logs === 'boolean' ? !logging.logs.invocation_logs : undefined),
    workerTracesDisabled: observed(typeof logging?.traces?.enabled === 'boolean' ? !logging.traces.enabled : undefined),
    accountRequiresTwoFactor: observed(account?.settings?.enforce_twofactor),
    administratorAndTokenInventoryReviewed: unknown(),
    moderatorConfigured: observed(health?.moderationConfigured),
    moderatorEncryptedBindingPresent: observed(moderatorSecret === true ? true : undefined),
    maintenanceConfigured: observed(health?.maintenanceConfigured),
    maintenanceRecent: observed(health?.maintenanceRecent),
    backupConfigured: observed(backupConfigured),
    backupRecent: observed(backupRecent),
    backupDestinationPrivate: observed(backupManaged === false || backupCustom === false ? false : backupManaged === true && backupCustom === true ? true : undefined),
    backupMaximumRetentionPolicy: observed(parseBackupRetention(evidence.backupLifecycle)),
    originalFileBackupRestoreVerified: unknown(),
    externalAlertDeliveryVerified: unknown(),
  };
  const states = Object.values(checks).map(check => check.status);
  return {
    readOnly: true,
    productionEvidenceComplete: states.every(state => state === 'verified'),
    attentionRequired: states.includes('attention'),
    unverifiedChecksRemain: states.includes('unknown'),
    checks,
  };
}

/** Capture child diagnostics in memory only; do not permit Wrangler debug logs,
 * telemetry, inherited debug options, credential prompts or console output. */
export function metadataCommandEnvironment(env = process.env) {
  const childEnv = { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG: 'log', NO_COLOR: '1', FORCE_COLOR: '0',
    CLOUDFLARE_API_BASE_URL: API_ORIGIN + '/client/v4', CLOUDFLARE_BASE_URL: API_ORIGIN + '/client/v4' };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NODE_DEBUG;
  delete childEnv.DEBUG;
  delete childEnv.CF_API_BASE_URL;
  // Wrangler otherwise prefers a global key/email over an explicitly supplied
  // API token. Never select the account using a different credential from the
  // token that will perform the following metadata/provisioning requests.
  if (childEnv.CLOUDFLARE_API_TOKEN) {
    for (const key of ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_KEY', 'CF_EMAIL', 'CF_API_TOKEN', 'CLOUDFLARE_API_USER_SERVICE_KEY']) delete childEnv[key];
  }
  return childEnv;
}

export function runWranglerPrivately(args, { cwd = process.cwd(), env = process.env } = {}) {
  const childEnv = metadataCommandEnvironment(env);
  return new Promise(resolveResult => {
    const child = execFile(process.execPath, [resolve(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args],
      { cwd, env: childEnv, timeout: 30_000, maxBuffer: MAX_RESPONSE, encoding: 'utf8', windowsHide: true },
      (error, stdout) => resolveResult({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: error ? '' : stdout }));
    child.stdin?.end();
  });
}

async function boundedJson(response) {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/** Never read provider error bodies and never follow redirects with a token. */
export async function fetchMetadataPrivately(url, { token, fetchImpl = fetch } = {}) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return { ok: false, status: 0 };
    if (token && parsed.origin !== API_ORIGIN) return { ok: false, status: 0 };
    const response = await fetchImpl(parsed.href, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok || response.status !== 200) {
      await response.body?.cancel();
      return { ok: false, status: response.status };
    }
    return { ok: true, status: 200, body: await boundedJson(response) };
  } catch { return { ok: false, status: 0 }; }
}

function selectedAccount(config, env, who) {
  if (config.account_id && env.CLOUDFLARE_ACCOUNT_ID && config.account_id !== env.CLOUDFLARE_ACCOUNT_ID) return null;
  const explicit = config.account_id || env.CLOUDFLARE_ACCOUNT_ID;
  if (explicit !== undefined) return typeof explicit === 'string' && ACCOUNT_ID.test(explicit) ? explicit : null;
  if (who?.loggedIn === true && Array.isArray(who.accounts) && who.accounts.length === 1 && ACCOUNT_ID.test(who.accounts[0]?.id ?? '')) return who.accounts[0].id;
  return null;
}

export async function runOperationsAudit({ config, configPath = 'wrangler.jsonc', env = process.env, runPrivate = args => runWranglerPrivately(args, { env }), fetchMetadata = fetchMetadataPrivately, now = Date.now() }) {
  const evidence = {};
  const db = config?.d1_databases?.find(item => item.binding === 'DB');
  const bucket = config?.r2_buckets?.find(item => item.binding === 'BUCKET');
  const backupBucket = config?.r2_buckets?.find(item => item.binding === 'BACKUP_BUCKET');
  const expected = { databaseId: db?.database_id, databaseName: db?.database_name, crons: config?.triggers?.crons };
  const safelyRun = async args => { try { return await runPrivate([...args, '--config', configPath]); } catch { return { status: 1 }; } };
  const safelyFetch = async (url, options) => { try { return await fetchMetadata(url, options); } catch { return { ok: false, status: 0 }; } };
  evidence.whoami = await safelyRun(['whoami', '--json']);
  const who = privateCommandJson(evidence.whoami);
  const accountId = selectedAccount(config ?? {}, env, who);
  // Refuse ambiguous account selection: do not ask Wrangler to choose a random
  // account interactively or accidentally inspect a different user's bucket.
  if (who?.loggedIn === true && accountId) {
    const jobs = [];
    if (typeof db?.database_id === 'string' && typeof db?.database_name === 'string') {
      jobs.push(['d1Info', ['d1', 'info', 'DB', '--json']], ['timeTravel', ['d1', 'time-travel', 'info', 'DB', '--json']]);
    }
    if (RESOURCE_NAME.test(bucket?.bucket_name ?? '')) {
      jobs.push(['managedDomain', ['r2', 'bucket', 'dev-url', 'get', bucket.bucket_name]], ['customDomains', ['r2', 'bucket', 'domain', 'list', bucket.bucket_name]]);
    }
    if (RESOURCE_NAME.test(backupBucket?.bucket_name ?? '') && backupBucket.bucket_name !== bucket?.bucket_name) {
      jobs.push(['backupManagedDomain', ['r2', 'bucket', 'dev-url', 'get', backupBucket.bucket_name]],
        ['backupCustomDomains', ['r2', 'bucket', 'domain', 'list', backupBucket.bucket_name]],
        ['backupLifecycle', ['r2', 'bucket', 'lifecycle', 'list', backupBucket.bucket_name]]);
    }
    if (RESOURCE_NAME.test(config?.name ?? '')) jobs.push(['secretNames', ['secret', 'list', '--format', 'json']]);
    const responses = await Promise.allSettled(jobs.map(async ([name, args]) => [name, await safelyRun(args)]));
    for (const response of responses) if (response.status === 'fulfilled') evidence[response.value[0]] = response.value[1];
  }
  // API-only checks use a token already supplied by the authorized build. OAuth
  // tokens/global API keys are never read from disk or extracted from Wrangler.
  const token = typeof env.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.length > 0 ? env.CLOUDFLARE_API_TOKEN : null;
  if (token && accountId && RESOURCE_NAME.test(config?.name ?? '')) {
    const root = `${API_ORIGIN}/client/v4/accounts/${accountId}`;
    const responses = await Promise.allSettled([
      ['account', root], ['schedules', `${root}/workers/scripts/${encodeURIComponent(config.name)}/schedules`],
      // This endpoint is script-only metadata. /settings includes bindings and
      // must not be substituted here, including as a permissions fallback.
      ['scriptSettings', `${root}/workers/scripts/${encodeURIComponent(config.name)}/script-settings`],
    ].map(async ([name, url]) => [name, await safelyFetch(url, { token })]));
    for (const response of responses) if (response.status === 'fulfilled') evidence[response.value[0]] = response.value[1];
  }
  try {
    const origin = new URL(config?.vars?.APP_ORIGIN);
    if (origin.protocol === 'https:' && !origin.username && !origin.password) evidence.health = await safelyFetch(new URL('/api/health?check=operations', origin.origin).href, {});
  } catch { /* A missing/invalid health endpoint remains unknown. */ }
  return { checkedAt: new Date(now).toISOString(), ...summarizeOperationsEvidence(evidence, expected) };
}

export function auditExitCode(report) {
  return report.attentionRequired ? 1 : report.unverifiedChecksRemain ? 2 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  let configPath = existsSync('dist/server/wrangler.json') ? 'dist/server/wrangler.json' : 'wrangler.jsonc';
  let reportOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--report-only') reportOnly = true;
    else if (args[index] === '--config' && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--')) configPath = args[++index];
    else throw new Error('Unsupported audit option.');
  }
  // The repository's JSONC files contain plain JSON. Refuse ambiguous input
  // instead of evaluating config or importing environment/credential files.
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const report = await runOperationsAudit({ config, configPath });
  process.stdout.write(JSON.stringify({ ...report, reportOnly }, null, 2) + '\n');
  process.exitCode = reportOnly ? 0 : auditExitCode(report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Error messages/stacks can contain paths, provider bodies or credentials.
    process.stderr.write('Cloudflare operations audit could not produce verified evidence.\n');
    process.exitCode = 2;
  });
}
