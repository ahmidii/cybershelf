import CybershelfApp from '@/components/CybershelfApp';
import { getCurrentUser } from '@/app/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect your books · cybershelf', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function HardcoverCallback() {
  const user = await getCurrentUser();
  return <CybershelfApp key={user?.userId ?? 'guest'} accountId={user?.userId ?? null} initialView="connections" />;
}
