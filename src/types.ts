import { BatchId, PostageBatch, Reference } from '@ethersphere/bee-js';

export interface FileWithMetadata {
  reference: string | Reference;
  name: string;
  batchId: string | BatchId;
  shared: boolean;
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

export interface GranteeList {
  filesSharedWith: Map<string, string[]>;
}

// TODO: unify own files with shared and add stamp data potentially
export interface SharedMessage {
  owner: string;
  references: string[];
  timestamp?: number;
  message?: string;
}
