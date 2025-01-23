import { BatchId, Reference, ReferenceResponse } from '@ethersphere/bee-js';

export interface FileInfo {
  batchId: string | BatchId;
  fileRef: string | Reference;
  historyRef?: string | Reference;
  owner?: string;
  fileName?: string;
  timestamp?: number;
  shared?: boolean;
  customMetadata?: Record<string, string>;
}

export interface ReferenceWithHistory {
  reference: string;
  historyRef: string;
}

// TODO: unify own files with shared and add stamp data potentially
export interface ShareItem {
  owner: string;
  references: string[];
  timestamp?: number;
  message?: string;
}

export interface Bytes<Length extends number> extends Uint8Array {
  readonly length: Length;
}
export type IndexBytes = Bytes<8>;
export interface Epoch {
  time: number;
  level: number;
}
export type Index = number | Epoch | IndexBytes | string;
interface FeedUpdateHeaders {
  feedIndex: Index;
  feedIndexNext: string;
}
export interface FetchFeedUpdateResponse extends ReferenceResponse, FeedUpdateHeaders {}
const feedTypes = ['sequence', 'epoch'] as const;
export type FeedType = (typeof feedTypes)[number];
