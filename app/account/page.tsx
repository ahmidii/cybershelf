import type { Metadata } from 'next';
import { getAuthAvailability, requireCurrentUser } from '@/app/auth';
import AccountSettings from '@/components/AccountSettings';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your account — cybershelf',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function AccountPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const user = await requireCurrentUser('/account');
  const params = await searchParams;
  const { emailAvailable } = getAuthAvailability();
  return <AccountSettings user={user} emailAvailable={emailAvailable} verificationError={!!params.error && !user.emailVerified}/>;
}
