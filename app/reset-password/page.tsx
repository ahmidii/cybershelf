import type { Metadata } from 'next';
import { getAuthAvailability } from '@/app/auth';
import AccountRecovery from '@/components/AccountRecovery';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Choose a new password — cybershelf',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const availability = getAuthAvailability();
  const token = typeof params.token === 'string' && params.token.length <= 512 ? params.token : '';
  return <AccountRecovery mode="reset" available={availability.available} emailAvailable={availability.emailAvailable} initialToken={token} invalidLink={!!params.error}/>;
}
