/** Community contributions are separate from private Library ratings and logs. */
export interface BookCommunityStats {
  averageRating: number | null;
  ratingCount: number;
  readCount: number;
  readerCount: number;
}

export interface CommunityRead { id: string; finishedAt: string; }
export interface MyBookCommunity {
  rating: number | null;
  reads: CommunityRead[];
  hasSharedCompletion: boolean;
}
export interface BookCommunityResponse { stats: BookCommunityStats; }
export interface BookCommunityMutationResponse extends BookCommunityResponse { mine: MyBookCommunity; }

/** Calendar dates make duplicate submissions independent of timestamp/timezone
 * formatting. Tomorrow in UTC is allowed for readers ahead of UTC. */
export function isCommunityReadDate(value: unknown, now = Date.now()): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
    value <= new Date(now + 86_400_000).toISOString().slice(0, 10);
}
