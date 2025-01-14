import { BatchId, Reference } from '@ethersphere/bee-js';

// TODO: maybe rename to FileInfo
export interface MetadataFile {
  reference: string | Reference;
  batchId: string | BatchId;
  shared?: boolean;
  name?: string;
  owner?: string;
  eGlRef?: string | Reference;
  historyRef?: string | Reference;
  timestamp?: number;
}

export interface OwnerFeedData {
  history: string;
  metadataListReference: string;
}

// export interface MetadataFile {
//   history: string;
//   metadataReference: string;
// }

// TODO: unify own files with shared and add stamp data potentially
export interface SharedMessage {
  owner: string;
  references: string[];
  timestamp?: number;
  message?: string;
}
