import type { Metadata } from 'next';
import { getAuthAvailability } from '@/app/auth';
import AccountRecovery from '@/components/AccountRecovery';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Reset your password — cybershelf',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ForgotPasswordPage() {
  const availability = getAuthAvailability();
  return <AccountRecovery mode="request" available={availability.available} emailAvailable={availability.emailAvailable}/>;
}
