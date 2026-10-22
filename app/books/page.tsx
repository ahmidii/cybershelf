import type { Metadata } from 'next';
import BookDirectory from '@/components/BookDirectory';

export const metadata: Metadata = { title: 'Find a book · cybershelf', description: 'Explore books, their editions, and the readers who bring them to life on Cybershelf.' };
export const dynamic = 'force-dynamic';

export default async function BooksPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const query = (await searchParams).q;
  return <BookDirectory initialQuery={typeof query === 'string' ? query.trim().slice(0, 200) : ''} />;
}
