import PublicShelf from '../../../components/PublicShelf';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/app/auth';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'A shared shelf · cybershelf',description:'A little world of books, arranged and shared on cybershelf.'};

export default async function SharedShelfPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const user=await getCurrentUser();
  return <PublicShelf id={id} accountId={user?.userId??null}/>;
}
