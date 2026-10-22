'use client';
import { useEffect, useState } from 'react';
import { Check, LoaderCircle, UserPlus } from 'lucide-react';
import { ACCOUNT_ID_HEADER, signInPath } from '@/lib/auth-contract';
import styles from './Feed.module.css';

export default function FollowButton({ profileId, className = '' }: { profileId: string; className?: string }) {
  const [accountId, setAccountId] = useState<string | null>(null), [ownProfileId, setOwnProfileId] = useState('');
  const [following, setFollowing] = useState(false), [loading, setLoading] = useState(true), [guest, setGuest] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setGuest(false); setOwnProfileId(''); setAccountId(null); setFollowing(false);
    void fetch('/api/follows', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (response.status === 401) { if (!controller.signal.aborted) setGuest(true); return; }
      const result = await response.json() as { accountId: string; ownProfileId?: string; following: { id: string }[]; error?: string }; if (!response.ok) throw new Error(result.error || 'Could not check this follow.');
      if (controller.signal.aborted) return;
      setAccountId(result.accountId); setOwnProfileId(result.ownProfileId || ''); setFollowing(result.following.some((reader: { id: string }) => reader.id === profileId));
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not check this follow.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [profileId, attempt]);
  const toggle = async () => {
    if (!accountId || busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(following ? '/api/follows/' + encodeURIComponent(profileId) : '/api/follows', {
        method: following ? 'DELETE' : 'POST', headers: { [ACCOUNT_ID_HEADER]: accountId, 'Content-Type': 'application/json' },
        ...(following ? {} : { body: JSON.stringify({ profileId }) }),
      });
      const result = await response.json() as { following: boolean; error?: string }; if (!response.ok) throw new Error(result.error || 'Could not update this follow.');
      setFollowing(result.following); window.dispatchEvent(new Event('cybershelf:following-changed'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this follow.'); }
    finally { setBusy(false); }
  };
  if (ownProfileId === profileId) return null;
  if (guest) return <a className={`button secondary ${className}`} href={signInPath('/u/' + profileId)}><UserPlus size={15} />Follow</a>;
  return <span className={`${styles.followControl} ${className}`}>
    <button type="button" className={`button ${following ? 'secondary' : 'primary'}`} onClick={() => void toggle()} disabled={loading || busy || !accountId} aria-pressed={following}>
      {loading || busy ? <LoaderCircle size={15} className="spin" /> : following ? <Check size={15} /> : <UserPlus size={15} />}
      {loading ? 'Loading…' : following ? 'Following' : 'Follow'}
    </button>
    {error ? <span className={styles.smallError} role="alert">{error} <button type="button" className="text-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></span> : null}
  </span>;
}
