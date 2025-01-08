import { BatchId, PostageBatch, Reference } from '@ethersphere/bee-js';

export interface FileWithMetadata {
  reference: string | Reference;
  name: string;
  batchId: string | BatchId;
  timestamp?: number;
  uploader?: string;
}

export interface StampWithMetadata {
  stamp: PostageBatch;
  fileReferences?: string[] | Reference[];
  feedReference?: string | Reference;
  nextIndex?: number;
}

export interface StampList {
  filesOfStamps: Map<string, string[]>;
}
