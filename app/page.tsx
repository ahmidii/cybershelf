import CybershelfApp from '@/components/CybershelfApp';
import { getCurrentUser } from './auth';
export const dynamic='force-dynamic';
export default async function Home(){const user=await getCurrentUser();return <CybershelfApp key={user?.userId??'guest'} accountId={user?.userId??null}/>;}
