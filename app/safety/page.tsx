import type { Metadata } from 'next';
import { requireCurrentUser } from '../auth';
import AccountFrame from '@/components/AccountFrame';
import SafetySettings from '@/components/SafetySettings';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Safety & blocked readers — cybershelf',robots:{index:false,follow:false}};
export default async function SafetyPage(){const user=await requireCurrentUser('/safety');return <AccountFrame wide><SafetySettings accountId={user.userId}/></AccountFrame>;}
