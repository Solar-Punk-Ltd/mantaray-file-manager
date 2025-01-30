import { BatchId, Reference } from '@ethersphere/bee-js';

export interface FileInfo {
  batchId: string | BatchId;
  eFileRef: string | Reference;
  historyRef?: string | Reference;
  owner?: string;
  fileName?: string;
  timestamp?: number;
  shared?: boolean;
  preview?: string;
  customMetadata?: Record<string, string>;
}

export interface ReferenceWithHistory {
  reference: string;
  historyRef: string;
}

// TODO: consider using a completely seprarate type for the manifestfeed because of topic === reference
export interface WrappedMantarayFeed extends ReferenceWithHistory {
  eFileRef?: string;
  eGranteeRef?: string;
}

export interface ShareItem {
  fileInfo: FileInfo;
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
const feedTypes = ['sequence', 'epoch'] as const;
export type FeedType = (typeof feedTypes)[number];
