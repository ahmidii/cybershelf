import { normalizeCatalogId, normalizeOpenLibraryWorkId } from '@/lib/book-catalog';
import { lookupCatalogBook } from '@/lib/server/book-catalog';
import { readCommunityCatalogBook } from '@/lib/server/book-community';
import { handled, HttpError, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  return handled(async () => {
    const { bookId: rawId } = await context.params;
    const bookId = normalizeCatalogId(rawId);
    if (!bookId) throw new HttpError(400, 'Choose a valid book catalog identifier.');
    const offsetText = new URL(request.url).searchParams.get('offset') ?? '0';
    if (!/^\d{1,6}$/.test(offsetText) || Number(offsetText) > 100000) throw new HttpError(400, 'Choose a valid edition page.');
    const book = normalizeOpenLibraryWorkId(bookId)
      ? await lookupCatalogBook(bookId, Number(offsetText))
      : await readCommunityCatalogBook(bookId);
    if (!book) throw new HttpError(404, 'This book was not found in the catalog.');
    return json({ book }, 200, { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' });
  });
}
