import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireCurrentUser } from '../auth';
import { configuredModerator } from '@/lib/server/moderation';
import AccountFrame from '@/components/AccountFrame';
import ModerationPanel from '@/components/ModerationPanel';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Moderation — cybershelf',robots:{index:false,follow:false}};
export default async function ModerationPage(){const user=await requireCurrentUser('/moderation');if(!configuredModerator(user.userId))redirect('/safety');return <AccountFrame wide><ModerationPanel accountId={user.userId}/></AccountFrame>;}
