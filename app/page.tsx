import CybershelfApp from '@/components/CybershelfApp';
import { getCurrentUser } from './auth';
export const dynamic='force-dynamic';
export default async function Home({searchParams}:{searchParams:Promise<{view?:string|string[];book?:string|string[];add?:string|string[]}>}){
 const [user,query]=await Promise.all([getCurrentUser(),searchParams]);
 const view=query.view==='together'||query.view==='library'||query.view==='explore'?query.view:'shelves';
 const book=typeof query.book==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(query.book)?query.book:undefined;
 return <CybershelfApp key={user?.userId??'guest'} accountId={user?.userId??null} initialView={view} initialBookId={book} initialAddTab={query.add==='manual'?'manual':undefined}/>;
}
