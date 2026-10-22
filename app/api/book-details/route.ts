import { handled, HttpError, json } from '@/lib/server/http';
import { normalizeBookISBN } from '@/lib/book-size';
import { lookupEdition } from '@/lib/server/book-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handled(async () => {
    const isbn = normalizeBookISBN(new URL(request.url).searchParams.get('isbn'));
    if (!isbn) throw new HttpError(400, 'Enter a valid ISBN for this edition.');
    return json({ edition: await lookupEdition(isbn) });
  });
}
