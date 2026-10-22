import PublicProfile from '@/components/PublicProfile';
import type { Metadata } from 'next';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'A reader’s corner · cybershelf',description:'A reading life, introduced through one favourite shelf.'};
export default async function ReaderProfilePage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;return <PublicProfile key={id} id={id}/>;
}
