import { BatchId, PostageBatch, Reference } from '@ethersphere/bee-js';

export interface FileWithMetadata {
  reference: string | Reference;
  batchId: string | BatchId;
  shared?: boolean;
  name?: string;
  owner?: string;
  eGlRef?: string | Reference;
  timestamp?: number;
}

export interface StampWithMetadata {
  stamp: PostageBatch;
  references?: string[] | Reference[];
  feedReference?: string | Reference;
  nextIndex?: number;
}

export interface StampList {
  filesOfStamps: Map<string, string[]>;
}

// TODO: unify own files with shared and add stamp data potentially
export interface SharedMessage {
  owner: string;
  references: string[];
  timestamp?: number;
  message?: string;
}
