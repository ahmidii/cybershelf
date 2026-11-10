import PublicProfile from '@/components/PublicProfile';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/app/auth';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'A reader’s corner · cybershelf',description:'A reading life, introduced through one favourite shelf.'};
export default async function ReaderProfilePage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;const user=await getCurrentUser();return <PublicProfile key={id} id={id} accountId={user?.userId??null}/>;
}
