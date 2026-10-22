import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthAvailability, getCurrentUser } from '@/app/auth';
import { safeRelativeReturnPath } from '@/lib/auth-contract';
import SignIn from '@/components/SignIn';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in — cybershelf',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ return_to?: string | string[]; reauth?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(Array.isArray(params.return_to) ? params.return_to[0] : params.return_to);
  const availability = await getAuthAvailability();
  const reauthenticate = params.reauth === '1';
  const user = availability.available ? await getCurrentUser() : null;
  if (user && !reauthenticate) redirect(returnTo);
  return <SignIn returnTo={returnTo} available={availability.available} emailAvailable={availability.emailAvailable} reauthenticate={reauthenticate} initialEmail={reauthenticate ? user?.email : undefined}/>;
}
