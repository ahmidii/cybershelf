import type { ReadingComment, ReadingPost } from './types';

export type ReadingRoomOrder = 'position' | 'newest';

/** The ceiling comes from the selected, saved Library book, including rereads. */
export interface ReadingRoomPosition { progress: number; page?: number; }

export interface ReadingRoomResponse {
  items: ReadingPost[];
  reader: ReadingRoomPosition;
  followingCount: number;
  totalVisible: number;
  waitingCount: number;
  nextCursor?: string;
}

export interface ReadingRoomCommentsResponse {
  comments: ReadingComment[];
  reader: ReadingRoomPosition;
  waitingCount: number;
}
