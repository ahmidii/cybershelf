import type { Metadata } from 'next';
import ReadingThread from '@/components/ReadingThread';

export const dynamic = 'force-dynamic';
// Shared metadata deliberately contains no reading thoughts or reply excerpts.
export const metadata: Metadata = { title: 'A reading conversation · cybershelf', description: 'A moment in a reading life, with room for a little company.' };

export default async function ReadingThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReadingThread key={id} id={id}/>;
}
