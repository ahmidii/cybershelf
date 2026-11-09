/** Deployment-only provisioning of the explicitly configured backup bucket.
 * No CLI entrypoint: deploy-cloudflare owns when this authorized action runs.
 * Never reads disk credentials or secret values; never changes public access. */
import { privateCommandJson, runWranglerPrivately } from './verify-cloudflare-operations.mjs';

const API = 'https://api.cloudflare.com';
const ACCOUNT = /^[a-f0-9]{32}$/i;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const LIMIT = 256 * 1024;
export const BACKUP_LIFECYCLE_RULE_ID = 'cybershelf-backup-expiry-30-days';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const sameRules = (left, right) => canonical([...left].sort((a, b) => a.id.localeCompare(b.id))) === canonical([...right].sort((a, b) => a.id.localeCompare(b.id)));

function validatedRules(result) {
  if (!record(result) || !Array.isArray(result.rules) || result.rules.length > 1000
    || result.rules.some(rule => !record(rule) || typeof rule.id !== 'string' || !rule.id || typeof rule.enabled !== 'boolean' || !record(rule.conditions))) {
    fail('Backup lifecycle metadata was incomplete. Review the backup bucket in Cloudflare before deploying.');
  }
  if (new Set(result.rules.map(rule => rule.id)).size !== result.rules.length) fail('Backup lifecycle rule identities were ambiguous. Review the backup bucket before deploying.');
  return result.rules;
}

function matchesExpiry(rule) {
  const condition = rule.deleteObjectsTransition?.condition;
  return rule.enabled === true && (rule.conditions.prefix === '' || rule.conditions.prefix === undefined)
    && Object.keys(rule.conditions).every(key => key === 'prefix')
    && record(condition) && condition.type === 'Age' && condition.maxAge === MAX_AGE_SECONDS
    && Object.keys(condition).every(key => ['type', 'maxAge'].includes(key));
}

/** Preserve unrelated rules exactly. A conflicting managed rule is not a
 * license to overwrite an operator's retention decision. */
export function planBackupLifecycle(result) {
  const rules = validatedRules(result);
  const managed = rules.find(rule => rule.id === BACKUP_LIFECYCLE_RULE_ID);
  if (managed && !matchesExpiry(managed)) fail('The Cybershelf backup expiry rule conflicts with the required 30-day policy. Review it in Cloudflare before deploying; no lifecycle rule was changed.');
  if (rules.some(matchesExpiry)) return { changed: false, rules };
  if (rules.length >= 1000) fail('The backup bucket has no room for the required expiry rule. Review its lifecycle rules before deploying.');
  return { changed: true, rules: [...rules, {
    id: BACKUP_LIFECYCLE_RULE_ID, enabled: true, conditions: { prefix: '' },
    deleteObjectsTransition: { condition: { type: 'Age', maxAge: MAX_AGE_SECONDS } },
  }] };
}

async function boundedJson(response) {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > LIMIT) { await response.body?.cancel(); return null; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/** Transport only permits the R2 metadata/create/lifecycle surface used below.
 * Provider error bodies are neither read nor included in thrown diagnostics. */
export async function requestBackupApi({ url, method = 'GET', token, body, jurisdiction }, fetchImpl = fetch) {
  try {
    const parsed = new URL(url);
    const base = /^\/client\/v4\/accounts\/[a-f0-9]{32}\/r2\/buckets$/i;
    const resource = /^\/client\/v4\/accounts\/[a-f0-9]{32}\/r2\/buckets\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9](?:\/(?:domains\/(?:managed|custom)|lifecycle|lock))?$/i;
    const allowed = method === 'GET' && resource.test(parsed.pathname)
      || method === 'POST' && base.test(parsed.pathname)
      || method === 'PUT' && resource.test(parsed.pathname) && parsed.pathname.endsWith('/lifecycle');
    if (parsed.origin !== API || parsed.username || parsed.password || parsed.search || parsed.hash || !allowed
      || typeof token !== 'string' || !token || /[\r\n]/.test(token)
      || jurisdiction !== undefined && !['default', 'eu', 'fedramp'].includes(jurisdiction)) return { ok: false, status: 0 };
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && Buffer.byteLength(encoded) > LIMIT) return { ok: false, status: 0 };
    const response = await fetchImpl(parsed.href, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        ...(encoded ? { 'Content-Type': 'application/json' } : {}),
        ...(jurisdiction ? { 'cf-r2-jurisdiction': jurisdiction } : {}),
        ...(method === 'PUT' ? { 'cf-r2-data-catalog-check': 'true' } : {}),
      },
      ...(encoded ? { body: encoded } : {}),
    });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, status: response.status }; }
    const json = await boundedJson(response);
    return json?.success === true ? { ok: true, status: response.status, result: json.result } : { ok: false, status: response.status };
  } catch { return { ok: false, status: 0 }; }
}

async function accountIdFor(config, env, configPath, runPrivate) {
  if (config.account_id && env.CLOUDFLARE_ACCOUNT_ID && config.account_id !== env.CLOUDFLARE_ACCOUNT_ID) fail('Cloudflare account configuration is inconsistent. Review the deployment account before provisioning backups.');
  const configured = config.account_id || env.CLOUDFLARE_ACCOUNT_ID;
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !ACCOUNT.test(configured)) fail('Set a valid Cloudflare account ID in the deployment configuration before provisioning backups.');
    return configured;
  }
  let response;
  try { response = await runPrivate(['whoami', '--json', '--config', configPath]); } catch { /* Never expose child errors. */ }
  const who = privateCommandJson(response);
  if (who?.loggedIn === true && Array.isArray(who.accounts) && who.accounts.length === 1 && ACCOUNT.test(who.accounts[0]?.id ?? '')) return who.accounts[0].id;
  fail('The backup deployment account could not be selected unambiguously. Set CLOUDFLARE_ACCOUNT_ID for the existing authorized build and retry.');
}

export async function ensureBackupBucket({ config, configPath = 'wrangler.jsonc', env = process.env, runPrivate = args => runWranglerPrivately(args, { env }), request = requestBackupApi }) {
  if (!Array.isArray(config?.r2_buckets)) fail('Configure the primary BUCKET and separate BACKUP_BUCKET bindings before deploying backups.');
  const primaryBindings = config?.r2_buckets?.filter(item => item.binding === 'BUCKET') ?? [];
  const backupBindings = config?.r2_buckets?.filter(item => item.binding === 'BACKUP_BUCKET') ?? [];
  if (primaryBindings.length !== 1 || backupBindings.length !== 1) fail('Configure exactly one primary BUCKET and one separate BACKUP_BUCKET before deploying backups.');
  const primary = primaryBindings[0], backup = backupBindings[0];
  if (!BUCKET.test(primary.bucket_name ?? '') || !BUCKET.test(backup.bucket_name ?? '') || backup.bucket_name === primary.bucket_name) fail('BACKUP_BUCKET must name a valid bucket separate from the primary file bucket. No bucket was changed.');
  if (backup.jurisdiction !== undefined && !['default', 'eu', 'fedramp'].includes(backup.jurisdiction)) fail('The configured backup bucket jurisdiction is unsupported. Review it before deployment.');
  const token = env.CLOUDFLARE_API_TOKEN;
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail('The existing Cloudflare build API token is unavailable. Configure its authorized build environment before provisioning backups; do not print the token.');
  const accountId = await accountIdFor(config, env, configPath, runPrivate);
  const collection = `${API}/client/v4/accounts/${accountId}/r2/buckets`;
  const bucketUrl = collection + '/' + encodeURIComponent(backup.bucket_name);
  const call = async (suffix = '', { method = 'GET', body, collectionRequest = false } = {}) => {
    try { return await request({ url: (collectionRequest ? collection : bucketUrl) + suffix, method, body, token, jurisdiction: backup.jurisdiction }); }
    catch { return { ok: false, status: 0 }; }
  };
  const checked = async (suffix, label) => {
    const result = await call(suffix);
    if (result?.ok !== true || result.status !== 200 || !record(result.result)) fail(`Could not verify ${label}. Check the existing build token's R2 permissions and retry; no provider details were logged.`);
    return result.result;
  };
  let created = false;
  let bucket = await call();
  if (bucket?.ok !== true && bucket?.status === 404) {
    const creation = await call('', { method: 'POST', body: { name: backup.bucket_name }, collectionRequest: true });
    created = creation?.ok === true;
    // A concurrent creation or an uncertain response is resolved by a fresh
    // metadata read, not by deleting/recreating a bucket or guessing an error.
    bucket = await call();
  }
  if (bucket?.ok !== true || bucket.status !== 200 || !record(bucket.result) || bucket.result.name !== backup.bucket_name) fail('Could not verify the configured backup bucket. Check account selection and the existing build token\'s R2 Storage Write permission, then retry.');
  if (backup.jurisdiction && (bucket.result.jurisdiction ?? 'default') !== backup.jurisdiction) fail('The backup bucket jurisdiction does not match its binding. Review the configured target before deploying.');

  const verifyPrivacy = async () => {
    const values = await Promise.all([checked('/domains/managed', 'backup managed-domain privacy'), checked('/domains/custom', 'backup custom-domain privacy')]);
    const [managed, custom] = values;
    if (typeof managed.enabled !== 'boolean' || !Array.isArray(custom.domains) || custom.domains.some(domain => !record(domain) || typeof domain.enabled !== 'boolean')) fail('Backup public-access metadata was incomplete. Review both public access settings in Cloudflare before deploying.');
    if (managed.enabled || custom.domains.some(domain => domain.enabled)) fail('The configured backup bucket has public access enabled. Review its managed URL and custom domains before deploying; no public access setting was changed.');
  };
  await verifyPrivacy();
  const locks = await checked('/lock', 'backup retention locks');
  if (!Array.isArray(locks.rules) || locks.rules.some(rule => !record(rule) || typeof rule.enabled !== 'boolean')) fail('Backup retention-lock metadata was incomplete. Review the bucket before deploying.');
  if (locks.rules.some(rule => rule.enabled)) fail('The backup bucket has an active retention lock. Review it against the 30-day backup policy before deploying; no lock was changed.');
  const original = validatedRules(await checked('/lifecycle', 'backup lifecycle rules'));
  const plan = planBackupLifecycle({ rules: original });
  if (plan.changed) {
    // Cloudflare's endpoint replaces the collection and does not document CAS.
    // Detect observed concurrent edits and preserve every existing rule. The
    // deployment/admin policy must still serialize lifecycle configuration.
    const latest = validatedRules(await checked('/lifecycle', 'backup lifecycle rules before update'));
    if (!sameRules(original, latest)) fail('Backup lifecycle rules changed during deployment. No update was made; retry after the other change completes.');
    const written = await call('/lifecycle', { method: 'PUT', body: { rules: plan.rules } });
    if (written?.ok !== true) fail('Could not configure backup expiry. Check the existing build token\'s R2 Storage Write permission and retry; existing Worker deployment has not been replaced.');
    const confirmed = validatedRules(await checked('/lifecycle', 'the saved backup expiry policy'));
    if (!confirmed.some(matchesExpiry) || !plan.rules.every(rule => confirmed.some(item => item.id === rule.id && canonical(item) === canonical(rule)))) fail('The saved backup lifecycle did not match the reviewed rules. Review the bucket before deploying; no further lifecycle change was attempted.');
    await verifyPrivacy();
  }
  return { created, private: true, lifecycleConfigured: true, lifecycleChanged: plan.changed };
}
