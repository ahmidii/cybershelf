import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthAvailability, getCurrentUser } from '@/app/auth';
import { safeRelativeReturnPath } from '@/lib/auth-contract';
import SignIn from '@/components/SignIn';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in — cybershelf',
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ return_to?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(Array.isArray(params.return_to) ? params.return_to[0] : params.return_to);
  const availability = await getAuthAvailability();
  if (availability.available && await getCurrentUser()) redirect(returnTo);
  return <SignIn returnTo={returnTo} available={availability.available}/>;
}
