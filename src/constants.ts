const feedTypes = ['sequence', 'epoch'] as const;
export type FeedType = (typeof feedTypes)[number];
export const DEFAULT_FEED_TYPE: FeedType = 'sequence';
export const REFERENCE_LIST_TOPIC = 'reference-list';
export const METADATA_TOPIC = 'metadata';
export const SHARED_INBOX_TOPIC = 'shared-inbox';
export const OWNER_FEED_STAMP_LABEL = 'owner-stamp';
