import { normalizeBookISBN } from '@/lib/book-size';
import { resolveCatalogBook } from '@/lib/server/book-catalog';
import { handled, HttpError, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handled(async () => {
    const params = new URL(request.url).searchParams;
    const title = (params.get('title') ?? '').trim();
    const author = (params.get('author') ?? '').trim();
    const rawISBN = (params.get('isbn') ?? '').trim();
    if (title.length > 500 || author.length > 500 || rawISBN.length > 40) throw new HttpError(400, 'These book details are too long.');
    const isbn = normalizeBookISBN(rawISBN);
    if (rawISBN && !isbn) throw new HttpError(400, 'Enter a valid ISBN or look up the title and author.');
    if (!title && !isbn) throw new HttpError(400, 'Enter a title or ISBN to find a book.');
    // Inputs may originate in a private library. Do not cache the URL response at
    // shared CDNs or echo the reader's title/author alongside catalog candidates.
    return json(await resolveCatalogBook({ title, author, isbn }));
  });
}
