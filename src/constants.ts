const feedTypes = ['sequence', 'epoch'] as const;
export type FeedType = (typeof feedTypes)[number];
export const DEFAULT_FEED_TYPE: FeedType = 'sequence';
export const STAMP_LIST_TOIC = 'stamps';
export const SHARED_INBOX_TOPIC = 'shared-inbox';
