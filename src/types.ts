export interface FileMetadata {
  reference: string;
  name: string;
  batchId?: string;
  timestamp?: number;
  uploader?: string;
}

const feedTypes = ['sequence', 'epoch'] as const;
export type FeedType = (typeof feedTypes)[number];
export const DEFAULT_FEED_TYPE: FeedType = 'sequence';
