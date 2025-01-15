import { BatchId, Reference } from '@ethersphere/bee-js';

export interface FileInfo {
  fileRef: string | Reference;
  batchId: string | BatchId;
  shared?: boolean;
  fileName?: string;
  owner?: string;
  eGlRef?: string | Reference;
  historyRef?: string | Reference;
  timestamp?: number;
}

export interface FileInfoHistory {
  fileInfoHistoryRef: string;
}

export interface OwnerFeedData {
  wrappedFeedListRef: string;
  historyRef: string;
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
