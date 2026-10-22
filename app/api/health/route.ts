import { getAuthAvailability } from '@/app/auth';

export const dynamic = 'force-dynamic';

// Public capability flags only, matching what the sign-in UI already shows.
// Never include secret values, account data, or internal configuration errors.
export function GET() {
  const availability = getAuthAvailability();
  return Response.json({
    accounts: availability.available,
    email: availability.emailAvailable,
  }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
