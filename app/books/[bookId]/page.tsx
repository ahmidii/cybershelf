import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/app/auth';
import { normalizeCatalogId } from '@/lib/book-catalog';
import { lookupCatalogWork } from '@/lib/server/book-catalog';
import { readCommunityCatalogBook } from '@/lib/server/book-community';
import PublicBook from '@/components/PublicBook';

export const dynamic = 'force-dynamic';
const publicBookInfo = cache((id: string) => id.startsWith('cs_') ? readCommunityCatalogBook(id) : lookupCatalogWork(id));

export async function generateMetadata({ params }: { params: Promise<{ bookId: string }> }): Promise<Metadata> {
  const { bookId } = await params;
  const fallback: Metadata = { title: 'A book, in good company · cybershelf', description: 'Explore editions, community ratings, and completed reads. Find a place for this book in your library.' };
  const id = normalizeCatalogId(bookId);
  if (!id || id !== bookId) return fallback;
  try {
    const book = await publicBookInfo(id);
    if (!book) return fallback;
    const title = `${book.title} · cybershelf`;
    const description = book.description ? book.description.slice(0, 180) : `${book.title} by ${book.author}. Explore editions, community ratings, and reading journeys on Cybershelf.`;
    return { title, description, alternates: { canonical: `https://cybershelf.io/books/${id}` }, openGraph: { title, description, ...(book.coverUrl ? { images: [{ url: book.coverUrl }] } : {}) } };
  } catch { return fallback; }
}

export default async function PublicBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const id = normalizeCatalogId(bookId);
  if (!id || id !== bookId) notFound();
  const [user, lookup] = await Promise.all([
    getCurrentUser(),
    publicBookInfo(id).then(book => ({ book }), () => ({ unavailable: true as const })),
  ]);
  // A missing record is a real 404. An upstream interruption can still render
  // the client retry state rather than claiming that the book does not exist.
  if ('book' in lookup && !lookup.book) notFound();
  return <PublicBook key={`${id}:${user?.userId ?? 'guest'}`} id={id} accountId={user?.userId ?? null} />;
}
