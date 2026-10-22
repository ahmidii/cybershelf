import { randomBytes } from 'node:crypto';

const secretName = 'BETTER_AUTH_SECRET';

// This is deployment-only code. It never reads an existing secret value,
// rotates a configured key, or stores new credentials in a file or argument.
// The caller supplies Wrangler's stdin transport and captures its output.
export function ensureAuthSecret({ runPrivate, buildSecret, accountsAvailable = false, configPath = 'wrangler.jsonc', generate = () => randomBytes(48).toString('base64url') }) {
  const listed = runPrivate(['secret', 'list', '--format', 'json', '--config', configPath]);
  if (listed.status !== 0 || listed.error) {
    throw new Error('Could not check the Worker authentication secret. Keep the existing secret unchanged; check that the build token has Workers Scripts Edit permission.');
  }
  let secrets;
  try { secrets = JSON.parse(listed.stdout); } catch {
    throw new Error('Cloudflare returned an unreadable secret list. No authentication secret was changed.');
  }
  if (!Array.isArray(secrets) || secrets.some(item => !item || typeof item.name !== 'string' || typeof item.type !== 'string')) {
    throw new Error('Cloudflare returned an unexpected secret list. No authentication secret was changed.');
  }
  if (secrets.some(item => item.name === secretName)) return 'existing';
  // Older self-hosts may have used a plaintext runtime binding. Do not replace
  // a working key just because it is absent from Cloudflare's secret-name list.
  if (accountsAvailable) return 'runtime-existing';

  const secret = buildSecret === undefined ? generate() : buildSecret;
  if (typeof secret !== 'string' || secret.trim().length < 32 || /[\r\n\0]/.test(secret)) {
    throw new Error('BETTER_AUTH_SECRET in the build environment must be a single-line random value of at least 32 characters. Remove the invalid build value to generate a new key, or set a valid runtime secret in the Worker settings.');
  }
  const uploaded = runPrivate(['secret', 'put', secretName, '--config', configPath], secret);
  if (uploaded.status !== 0 || uploaded.error) {
    throw new Error('Could not configure the Worker authentication secret. Add BETTER_AUTH_SECRET under the Worker’s Variables and Secrets, then redeploy. No secret value is printed.');
  }
  return 'created';
}
