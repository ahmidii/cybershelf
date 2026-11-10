import { getAuthAvailability } from '@/app/auth';
import { env } from 'cloudflare:workers';
import { maintenanceStatus } from '@/lib/server/maintenance';
import { originalBackupStatus } from '@/lib/server/original-backups';

export const dynamic = 'force-dynamic';

// Public capability flags only, matching what the sign-in UI already shows.
// Never include secret values, account data, or internal configuration errors.
export async function GET(request: Request) {
  const availability = getAuthAvailability();
  const capabilities = {
    accounts: availability.available,
    email: availability.emailAvailable,
  };
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
  if (new URL(request.url).searchParams.get('check') !== 'operations') return Response.json(capabilities, { headers });

  // This opt-in monitor reports booleans only. It never returns identities,
  // queue lengths, object keys, credentials, provider errors or backup cursors.
  try {
    const setting = env.MODERATOR_USER_IDS ?? '';
    const ids = setting.length <= 4096 ? setting.split(',').map(id => id.trim()).filter(Boolean) : [];
    const validIds = ids.length > 0 && ids.length <= 20 && ids.every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id));
    const moderator = validIds && env.DB ? await env.DB.prepare(`SELECT 1 AS configured FROM auth_user u
      WHERE u.id IN (${ids.map(() => '?').join(',')}) AND NOT EXISTS
      (SELECT 1 FROM account_suspensions s WHERE s.user_id=u.id) LIMIT 1`).bind(...ids).first() : null;
    const [maintenance, backup] = await Promise.all([maintenanceStatus(env), originalBackupStatus(env)]);
    return Response.json({ ...capabilities, release: '0.9.1', operations: {
      moderationConfigured: !!moderator,
      maintenanceConfigured: maintenance.configured,
      maintenanceStarted: maintenance.started,
      maintenanceRecent: maintenance.recent,
      cleanupHealthy: maintenance.cleanupHealthy,
      backupConfigured: backup.configured,
      backupRecent: backup.state === 'current',
    } }, { headers });
  } catch {
    return Response.json({ ...capabilities, release: '0.9.1', operations: {
      moderationConfigured: false, maintenanceConfigured: false, maintenanceStarted: false, maintenanceRecent: false,
      cleanupHealthy: false, backupConfigured: false, backupRecent: false,
    } }, { status: 503, headers });
  }
}
