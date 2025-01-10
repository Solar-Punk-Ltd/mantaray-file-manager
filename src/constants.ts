const feedTypes = ['sequence', 'epoch'] as const;
export type FeedType = (typeof feedTypes)[number];
export const DEFAULT_FEED_TYPE: FeedType = 'sequence';
//export const STAMP_LIST_TOPIC = 'stamps';//not good
export const STAMP_LIST_TOPIC = '0000000000000000000000000000000000000000000000000000000000000000';
