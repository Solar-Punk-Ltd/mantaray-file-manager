import {
  BatchId,
  Bee,
  BeeRequestOptions,
  Data,
  GetGranteesResult,
  GranteesResult,
  NodeAddresses,
  PostageBatch,
  PssSubscription,
  RedundancyLevel,
  Reference,
  Signer,
  STAMPS_DEPTH_MAX,
  Topic,
  TOPIC_BYTES_LENGTH,
  TOPIC_HEX_LENGTH,
  Utils,
} from '@ethersphere/bee-js';
import { initManifestNode, MantarayNode, MetadataMapping } from '@solarpunkltd/mantaray-js';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';

import {
  DEFAULT_FEED_TYPE,
  FILEIINFO_NAME,
  FILEIINFO_PATH,
  FILEINFO_HISTORY_NAME,
  FILEINFO_HISTORY_PATH,
  OWNER_FEED_STAMP_LABEL,
  REFERENCE_LIST_TOPIC,
  SHARED_INBOX_TOPIC,
  SWARM_ZERO_ADDRESS,
} from './constants';
import {
  Bytes,
  FetchFeedUpdateResponse,
  FileInfo,
  ReferenceWithHistory,
  ShareItem,
  WrappedMantarayFeed,
} from './types';
import {
  assertFileInfo,
  assertReference,
  assertReferenceWithHistory,
  assertShareItem,
  assertTopic,
  assertWrappedMantarayFeed,
  decodeBytesToPath,
  encodePathToBytes,
  getContentType,
  isNotFoundError,
  makeBeeRequestOptions,
  makeNumericIndex,
  numberToFeedIndex,
} from './utils';

export class FileManager {
  private bee: Bee;
  private wallet: Wallet;
  private signer: Signer;
  private importedReferences: string[];
  private stampList: PostageBatch[];
  private mantarayFeedList: WrappedMantarayFeed[];
  private fileInfoList: FileInfo[];
  private nextOwnerFeedIndex: number;
  private sharedWithMe: ShareItem[];
  private sharedSubscription: PssSubscription | undefined;
  private ownerFeedTopic: Topic;

  constructor(bee: Bee, privateKey: string) {
    console.log('Initializing Bee client...');
    this.bee = bee;
    this.sharedSubscription = undefined;
    this.wallet = new Wallet(privateKey);
    this.signer = {
      address: Utils.hexToBytes(this.wallet.address.slice(2)),
      sign: async (data: Data): Promise<string> => {
        return await this.wallet.signMessage(data);
      },
    };
    this.stampList = [];
    this.importedReferences = [];
    this.fileInfoList = [];
    this.mantarayFeedList = [];
    this.nextOwnerFeedIndex = 0;
    this.ownerFeedTopic = this.bee.makeFeedTopic(SWARM_ZERO_ADDRESS);
    this.sharedWithMe = [];
  }

  // Start init methods
  // TODO: use allSettled for file fetching and only save the ones that are successful
  async initialize(items?: any): Promise<void> {
    await this.initStamps();
    await this.initOwnerFeedTopic();
    await this.initMantarayFeedList();
    await this.initFileInfoList();

    try {
      if (items) {
        console.log('Using provided items for initialization.');
        await this.importLocalReferences(items);
      } else {
        console.log('Fetching all pinned references for initialization.');
        await this.importPinnedReferences();
      }
      console.log('References imported successfully.');
    } catch (error: any) {
      console.error(`[ERROR] Failed to import references: ${error.message}`);
    }
  }

  private async initOwnerFeedTopic(): Promise<void> {
    const referenceListTopicHex = this.bee.makeFeedTopic(REFERENCE_LIST_TOPIC);
    const feedTopicData = await this.getFeedData(referenceListTopicHex, this.wallet.address, 0);

    if (feedTopicData.reference === SWARM_ZERO_ADDRESS) {
      const ownerFeedStamp = this.getOwnerFeedStamp();
      if (ownerFeedStamp === undefined) {
        throw 'Owner stamp not found';
      }

      this.ownerFeedTopic = Utils.bytesToHex(randomBytes(TOPIC_BYTES_LENGTH), TOPIC_HEX_LENGTH);
      const topicDataRes = await this.bee.uploadData(ownerFeedStamp.batchID, this.ownerFeedTopic, { act: true });
      const fw = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, referenceListTopicHex, this.signer);
      await fw.upload(ownerFeedStamp.batchID, topicDataRes.reference, { index: numberToFeedIndex(0) });
      await fw.upload(ownerFeedStamp.batchID, topicDataRes.historyAddress as Reference, {
        index: numberToFeedIndex(1),
      });
    } else {
      const topicHistory = await this.getFeedData(referenceListTopicHex, this.wallet.address, 1);
      const publicKey = (await this.bee.getNodeAddresses()).publicKey;
      const options = makeBeeRequestOptions(topicHistory.reference, publicKey);

      const topicHex = (await this.bee.downloadData(feedTopicData.reference, options)).text();
      assertTopic(topicHex);
      this.ownerFeedTopic = topicHex;
    }
  }

  private async initStamps(): Promise<void> {
    try {
      this.stampList = await this.getUsableStamps();
      console.log('Usable stamps fetched successfully.');
    } catch (error: any) {
      console.error(`Failed to fetch stamps: ${error}`);
    }
  }

  // TODO: first need to init the mantaray feed with the topic
  private async initMantarayFeedList(): Promise<void> {
    const latestFeedData = await this.getFeedData(this.ownerFeedTopic);
    if (latestFeedData.reference === SWARM_ZERO_ADDRESS) {
      console.log("Owner mantaray feed doesn't exist yet.");
      return;
    }

    this.nextOwnerFeedIndex = makeNumericIndex(latestFeedData.feedIndexNext);
    const refWithHistory = latestFeedData as unknown as ReferenceWithHistory;
    assertReferenceWithHistory(refWithHistory);
    // const ownerFeedRawData = await this.bee.downloadData(latestFeedData.reference);
    // const ownerFeedData = JSON.parse(ownerFeedRawData.text());
    // assertReferenceWithHistory(ownerFeedData);

    const publicKey = (await this.bee.getNodeAddresses()).publicKey;
    const options = makeBeeRequestOptions(refWithHistory.historyRef, publicKey);
    const mantarayFeedListRawData = await this.bee.downloadData(refWithHistory.reference, options);
    const mantarayFeedListData: WrappedMantarayFeed[] = JSON.parse(mantarayFeedListRawData.text());

    for (const wmf of mantarayFeedListData) {
      try {
        assertWrappedMantarayFeed(wmf);
        this.mantarayFeedList.push(wmf);
      } catch (error: any) {
        console.error(`Invalid WrappedMantarayFeed item, skipping it: ${error}`);
      }
    }

    console.log('Mantaray feed list fetched successfully.');
  }

  // TODO: at this point we already have the efilerRef, so we can use it to fetch the data
  // TODO: already unwrapped historyRef by bee ?
  private async initFileInfoList(): Promise<void> {
    for (const mantaryFeedItem of this.mantarayFeedList) {
      const wrappedMantarayData = await this.getFeedData(mantaryFeedItem.reference);
      if (wrappedMantarayData.reference === SWARM_ZERO_ADDRESS) {
        console.log("mantaryFeedItem doesn't exist, skipping it.");
        continue;
      }

      const publicKey = (await this.bee.getNodeAddresses()).publicKey;
      let options = makeBeeRequestOptions(mantaryFeedItem.historyRef, publicKey);
      const wrappedMantarayRef = (await this.bee.downloadData(wrappedMantarayData.reference, options)).text();
      assertReference(wrappedMantarayRef);

      const mantaray = initManifestNode({
        obfuscationKey: randomBytes(TOPIC_BYTES_LENGTH) as Bytes<32>,
      });
      await this.loadMantaray(wrappedMantarayRef, mantaray);
      const histsoryFork = mantaray.getForkAtPath(encodePathToBytes(FILEINFO_HISTORY_PATH));
      const historyEntry = histsoryFork?.node.getEntry;
      if (historyEntry === undefined) {
        console.log("object doesn't have a history entry, ref: ", wrappedMantarayRef);
        continue;
      }

      const historyRef = (await this.bee.downloadData(historyEntry, options)).text();
      try {
        assertReference(historyRef);
      } catch (error: any) {
        console.error(`Invalid history reference: ${historyRef}`);
        continue;
      }

      const fileInfoFork = mantaray.getForkAtPath(encodePathToBytes(FILEIINFO_PATH));
      const fileInfoEntry = fileInfoFork?.node.getEntry;
      if (fileInfoEntry === undefined) {
        console.log("object doesn't have a fileinfo entry, ref: ", wrappedMantarayRef);
        continue;
      }

      options = makeBeeRequestOptions(historyRef, publicKey);
      const fileInfoRawData = await this.bee.downloadData(fileInfoEntry, options);
      const fileInfoData: FileInfo = JSON.parse(fileInfoRawData.text());

      try {
        assertFileInfo(fileInfoData);
        this.fileInfoList.push(fileInfoData);
      } catch (error: any) {
        console.error(`Invalid FileInfo item, skipping it: ${error}`);
      }
    }

    console.log('File info list fetched successfully.');
  }

  // End init methods

  // Start getter methods
  getFileInfoList(): FileInfo[] {
    return this.fileInfoList;
  }

  getSharedWithMe(): ShareItem[] {
    return this.sharedWithMe;
  }
  // End getter methods

  private async initializeFeed(batchId: string | BatchId, mantaray: MantarayNode): Promise<void> {
    console.log('Initializing wallet and checking for existing feed...');

    const reader = this.bee.makeFeedReader('sequence', this.ownerFeedTopic, this.wallet.address);

    try {
      const { reference } = await reader.download();
      console.log(`Existing feed found. Reference: ${reference}`);

      const manifestData = await this.bee.downloadData(reference);
      mantaray.deserialize(Buffer.from(manifestData));
      console.log('Mantaray structure initialized from feed.');
    } catch (error) {
      console.log('No existing feed found. Initializing new Mantaray structure...');
      mantaray = new MantarayNode();
      await this.saveFeed(batchId, mantaray);
    }
  }

  private async saveFeed(batchId: string | BatchId, mantaray: MantarayNode): Promise<void> {
    console.log('Saving Mantaray structure to feed...');

    // Save the Mantaray structure and get the manifest reference (Uint8Array)
    const manifestReference = await mantaray.save(async (data) => {
      const uploadResponse = await this.bee.uploadData(batchId, data);
      return uploadResponse.reference; // Ensure 64-byte reference
    });

    if (manifestReference.length === 64) manifestReference.padEnd(128, '0'); // Ensure hex string length is 128
    const hexManifestReference = manifestReference;

    // Create a feed writer and upload the manifest reference
    const writer = this.bee.makeFeedWriter('sequence', this.ownerFeedTopic, this.signer);
    await writer.upload(batchId, hexManifestReference as Reference); // Explicitly cast to Reference

    console.log(`Feed updated with reference: ${hexManifestReference}`);
  }

  private async fetchFeed(): Promise<Reference> {
    console.log('Fetching the latest feed reference...');

    const reader = this.bee.makeFeedReader(DEFAULT_FEED_TYPE, this.ownerFeedTopic, this.wallet.address);
    try {
      const { reference } = await reader.download();
      console.log(`Latest feed reference fetched: ${reference}`);
      return reference;
    } catch (error: unknown) {
      console.error('Failed to fetch feed:', (error as Error).message);
      throw new Error('Could not fetch feed reference.');
    }
  }

  // Start stamp methods
  private async getUsableStamps(): Promise<PostageBatch[]> {
    try {
      return (await this.bee.getAllPostageBatch()).filter((s) => s.usable);
    } catch (error: any) {
      console.error(`Failed to get usable stamps: ${error}`);
      return [];
    }
  }

  async filterBatches(ttl?: number, utilization?: number, capacity?: number): Promise<PostageBatch[]> {
    // TODO: clarify depth vs capacity
    return this.stampList.filter((s) => {
      if (utilization !== undefined && s.utilization <= utilization) {
        return false;
      }

      if (capacity !== undefined && s.depth <= capacity) {
        return false;
      }

      if (ttl !== undefined && s.batchTTL <= ttl) {
        return false;
      }

      return true;
    });
  }

  async getStamps(): Promise<PostageBatch[]> {
    return this.stampList;
  }

  getOwnerFeedStamp(): PostageBatch | undefined {
    return this.stampList.find((s) => s.label === OWNER_FEED_STAMP_LABEL);
  }

  getCachedStamp(batchId: string | BatchId): PostageBatch | undefined {
    return this.stampList.find((s) => s.batchID === batchId);
  }

  async fetchStamp(batchId: string | { batchID: string }): Promise<PostageBatch | undefined> {
    try {
      const id = typeof batchId === 'string' ? batchId : batchId.batchID;
      const newStamp = await this.bee.getPostageBatch(id);
      if (newStamp?.exists && newStamp.usable) {
        this.stampList.push(newStamp);
        return newStamp;
      }
    } catch (error: any) {
      console.error(`Failed to get stamp with batchID ${batchId}: ${error.message}`);
    }
  }

  async destroyVolume(batchId: string | BatchId): Promise<void> {
    if (batchId === this.getOwnerFeedStamp()?.batchID) {
      throw 'Cannot destroy owner stamp';
    }

    await this.bee.diluteBatch(batchId, STAMPS_DEPTH_MAX);

    for (let i = 0; i < this.stampList.length; i++) {
      if (this.stampList[i].batchID === batchId) {
        this.stampList.splice(i, 1);
        break;
      }
    }

    for (let i = 0; i < this.fileInfoList.length, ++i; ) {
      const fileInfo = this.fileInfoList[i];
      if (fileInfo.batchId === batchId) {
        this.fileInfoList.splice(i, 1);
        const mfIx = this.mantarayFeedList.findIndex((mf) => mf.eFileRef === fileInfo.eFileRef);
        if (mfIx !== -1) {
          this.mantarayFeedList.splice(mfIx, 1);
        }
      }
    }

    this.saveMantarayFeedList();

    console.log(`Volume destroyed: ${batchId}`);
  }
  // End stamp methods

  private async importReferences(referenceList: Reference[], isLocal = false): Promise<void> {
    const processPromises = referenceList.map(async (item: any) => {
      const reference: Reference = isLocal ? item.hash : item;
      try {
        console.log(`Processing reference: ${reference}`);

        // Download the file to extract its metadata
        const path = '/rootmetadata.json';
        const fileData = await this.bee.downloadFile(reference, path);
        const content = Buffer.from(fileData.data.toString() || '');
        const fileName = fileData.name || `pinned-${reference.substring(0, 6)}`;
        const contentType = fileData.contentType || 'application/octet-stream';
        const contentSize = content.length;

        // Build metadata dynamically based on the downloaded file
        const metadata = {
          'Content-Type': contentType,
          'Content-Size': contentSize.toString(),
          'Time-Uploaded': new Date().toISOString(),
          Filename: fileName,
          'Custom-Metadata': JSON.stringify({
            description: `Imported file: ${fileName}`,
            tags: ['imported', 'simulation', isLocal ? 'local' : 'pinned'],
          }),
          pinned: 'true',
        };

        console.log(`Adding Reference: ${reference} as ${fileName}`);
        // Add the file to the Mantaray node with enriched metadata
        const mantaray = initManifestNode();
        this.addToMantaray(mantaray, reference, metadata);

        // Track imported files
        this.importedReferences.push(reference);
      } catch (error: any) {
        console.error(`[ERROR] Failed to process reference ${reference}: ${error.message}`);
      }
    });

    await Promise.all(processPromises); // Wait for all references to be processed
  }

  private async importPinnedReferences(): Promise<void> {
    const allPins = await this.bee.getAllPins();
    await this.importReferences(allPins);
  }

  private async importLocalReferences(items: any): Promise<void> {
    await this.importReferences(items, undefined);
  }

  async downloadFile(
    mantaray: MantarayNode,
    filePath: string,
    onlyMetadata = false,
    options?: BeeRequestOptions,
  ): Promise<object> {
    console.log(`Downloading file: ${filePath}`);
    const normalizedPath = path.normalize(filePath);
    const segments = normalizedPath.split(path.sep);
    let currentNode = mantaray;

    // Traverse the Mantaray structure
    for (const segment of segments) {
      const segmentBytes = encodePathToBytes(segment); // Encode the segment to bytes
      const fork = Object.values(currentNode.forks || {}).find((f) => Buffer.compare(f.prefix, segmentBytes) === 0);

      if (!fork) throw new Error(`Path segment not found: ${segment}`);
      currentNode = fork.node;
    }

    if (!currentNode.isValueType()) {
      throw new Error(`Path does not point to a file: ${filePath}`);
    }

    const fileReference = currentNode.getEntry;
    if (!fileReference) throw new Error(`File reference not found for path: ${filePath}`);

    const metadata = currentNode.getMetadata || {};

    if (onlyMetadata) {
      // If only metadata is requested, skip downloading the file
      console.log(`Returning metadata only for: ${filePath}`);
      return { metadata };
    }

    console.log(`Downloading file with reference: ${fileReference}`);

    try {
      const fileData = await this.bee.downloadFile(fileReference, 'encryptedfilepath', options);
      return {
        data: fileData.data ? Buffer.from(fileData.data).toString('utf-8').trim() : '',
        metadata,
      };
    } catch (error: any) {
      console.error(`Error downloading file ${filePath}:`, error.message);
      throw error;
    }
  }

  async downloadFiles(mantaray: MantarayNode): Promise<object | null | undefined> {
    console.log('Downloading all files from Mantaray...');
    const forks = mantaray.forks;
    if (!forks) {
      console.log('No forks found in Mantaray.');
      return undefined; // Explicitly return undefined when there are no forks
    }

    const downloadPromises = [];

    for (const fork of Object.values(forks)) {
      const prefix = Utils.bytesToHex(fork.prefix || []);
      const fileReference = fork.node.getEntry;

      if (fork.node.isValueType() && fileReference) {
        const hexReference = Buffer.from(fileReference).toString('hex');
        const metadata = fork.node.getMetadata || {};

        downloadPromises.push(
          this.bee
            .downloadFile(hexReference)
            .then((fileData) => {
              console.log(`Contents of ${prefix}: ${Buffer.from(fileData.data).toString('utf-8')}`);
              return {
                path: prefix,
                data: Buffer.from(fileData.data).toString('utf-8'),
                metadata,
              };
            })
            .catch((error) => {
              console.error(`Error downloading file ${prefix}:`, error.message);
              return null; // Return null for failed downloads
            }),
        );
      } else if (!fork.node.isValueType()) {
        console.log(`Descending into directory: ${prefix}`);
        await this.downloadFiles(fork.node);
      }
    }

    const results = await Promise.all(downloadPromises);
    const validResults = results.filter((result) => result); // Filter out null for failed downloads

    if (validResults.length === 0) {
      return undefined; // Explicitly return undefined if no downloads succeeded
    }

    return validResults; // Return successful download results
  }

  async upload(
    batchId: string | BatchId,
    mantaray: MantarayNode,
    file: string,
    customMetadata: Record<string, string> = {},
    currentFileInfo: FileInfo | undefined = undefined,
  ): Promise<void> {
    const redundancyLevel = currentFileInfo?.redundancyLevel || RedundancyLevel.MEDIUM;
    const uploadFileRes = await this.uploadFile(batchId, file, currentFileInfo);

    const fileInfo: FileInfo = {
      eFileRef: uploadFileRes.reference,
      batchId: batchId,
      fileName: path.basename(file),
      owner: this.wallet.address,
      shared: false,
      historyRef: uploadFileRes.historyRef,
      timestamp: new Date().getTime(),
      redundancyLevel: redundancyLevel,
      customMetadata: customMetadata,
    };

    const fileInfoRes = await this.uploadFileInfo(batchId, fileInfo);
    mantaray.addFork(encodePathToBytes(FILEIINFO_PATH), fileInfoRes.reference as Reference, {
      'Content-Type': 'application/json',
      Filename: FILEIINFO_NAME,
    });

    const uploadHistoryRes = await this.uploadFileInfoHistory(batchId, fileInfoRes.historyRef, redundancyLevel);
    mantaray.addFork(encodePathToBytes(FILEINFO_HISTORY_PATH), uploadHistoryRes.historyRef as Reference);

    const wrappedMantarayRef = await this.saveMantaray(batchId, mantaray);
    const topicHex = currentFileInfo?.eFileRef || this.bee.makeFeedTopic(wrappedMantarayRef);
    assertTopic(topicHex);
    const wrappedFeedUpdateRes = await this.updateWrappedMantarayFeed(batchId, wrappedMantarayRef, topicHex);

    const feedUpdate: WrappedMantarayFeed = {
      reference: topicHex,
      historyRef: wrappedFeedUpdateRes.historyRef,
      eFileRef: fileInfoRes.reference,
    };
    const ix = this.mantarayFeedList.findIndex((f) => f.reference === feedUpdate.reference);
    if (ix !== -1) {
      this.mantarayFeedList[ix] = { ...feedUpdate, eGranteeRef: this.mantarayFeedList[ix].eGranteeRef };
    } else {
      this.mantarayFeedList.push(feedUpdate);
    }

    await this.saveMantarayFeedList();
  }

  private async uploadFile(
    batchId: string | BatchId,
    file: string,
    currentFileInfo: FileInfo | undefined = undefined,
  ): Promise<ReferenceWithHistory> {
    console.log(`Uploading file: ${file}`);
    const filePath = path.resolve(__dirname, file);
    const fileData = new Uint8Array(readFileSync(filePath));
    const fileName = path.basename(file);
    const contentType = getContentType(file);

    try {
      const options = makeBeeRequestOptions(currentFileInfo?.historyRef);
      const uploadFileRes = await this.bee.uploadFile(
        batchId,
        fileData,
        fileName,
        {
          act: true,
          redundancyLevel: currentFileInfo?.redundancyLevel || RedundancyLevel.MEDIUM,
          contentType: contentType,
        },
        options,
      );

      console.log(`File uploaded successfully: ${file}, Reference: ${uploadFileRes.reference}`);
      return { reference: uploadFileRes.reference, historyRef: uploadFileRes.historyAddress };
    } catch (error: any) {
      throw `Failed to upload file ${file}: ${error}`;
    }
  }

  private async uploadFileInfo(batchId: string | BatchId, fileInfo: FileInfo): Promise<ReferenceWithHistory> {
    try {
      const uploadInfoRes = await this.bee.uploadData(batchId, JSON.stringify(fileInfo), {
        act: true,
        redundancyLevel: fileInfo.redundancyLevel,
      });
      console.log('Fileinfo updated: ', uploadInfoRes.reference);

      this.fileInfoList.push(fileInfo);

      return { reference: uploadInfoRes.reference, historyRef: uploadInfoRes.historyAddress };
    } catch (error: any) {
      throw `Failed to save fileinfo: ${error}`;
    }
  }

  private async uploadFileInfoHistory(
    batchId: string | BatchId,
    hisoryRef: string,
    redundancyLevel: RedundancyLevel = RedundancyLevel.MEDIUM,
  ): Promise<ReferenceWithHistory> {
    try {
      const uploadHistoryRes = await this.bee.uploadData(batchId, hisoryRef, {
        redundancyLevel: redundancyLevel,
      });

      console.log('Fileinfo history updated: ', uploadHistoryRes.reference);

      return { reference: uploadHistoryRes.reference, historyRef: uploadHistoryRes.reference };
    } catch (error: any) {
      throw `Failed to save fileinfo history: ${error}`;
    }
  }

  private async updateWrappedMantarayFeed(
    batchId: string | BatchId,
    wrappedMantarayRef: Reference,
    topicHex: Topic,
  ): Promise<ReferenceWithHistory> {
    try {
      // TODO: test if feed ACT up/down actually works !!!
      const wrappedMantarayFw = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, topicHex, this.signer);
      const wrappedMantarayData = await this.bee.uploadData(batchId, wrappedMantarayRef, { act: true });
      const { reference } = await wrappedMantarayFw.upload(batchId, wrappedMantarayData.reference, {
        index: undefined, // todo: keep track of the latest index ??
      });

      return { reference: reference, historyRef: wrappedMantarayData.historyAddress };
    } catch (error: any) {
      throw `Failed to wrapped mantaray feed: ${error}`;
    }
  }

  private addToMantaray(mantaray: MantarayNode, reference: string, metadata: MetadataMapping = {}): void {
    const filePath = metadata.fullPath || metadata.Filename || 'file';
    const originalFileName = metadata.originalFileName || path.basename(filePath);

    const bytesPath = encodePathToBytes(filePath);

    const metadataWithOriginalName = {
      ...metadata,
      Filename: originalFileName, // Use the original filename here
    };

    mantaray.addFork(bytesPath, reference as Reference, metadataWithOriginalName);
  }

  private async saveMantaray(batchId: string | BatchId, mantaray: MantarayNode): Promise<Reference> {
    const saveFunction = async (data: Uint8Array): Promise<Reference> => {
      const uploadResponse = await this.bee.uploadData(batchId, data);
      return uploadResponse.reference;
    };

    return mantaray.save(saveFunction);
  }

  private async loadMantaray(manifestReference: Reference, mantaray: MantarayNode): Promise<void> {
    const loadFunction = async (address: Reference): Promise<Uint8Array> => {
      return this.bee.downloadData(address);
    };

    mantaray.load(loadFunction, manifestReference);
  }

  searchFilesByName(fileNameQuery: string, mantaray: MantarayNode, includeMetadata = false): any {
    console.log(`Searching for files by name: ${fileNameQuery}`);

    const allFiles = this.listFiles(mantaray, includeMetadata);

    const filteredFiles = allFiles.filter((file: any) => file.path.includes(fileNameQuery));

    return filteredFiles;
  }

  searchFiles(
    mantaray: MantarayNode,
    {
      fileName,
      directory,
      metadata,
      minSize,
      maxSize,
      extension,
    }: {
      fileName?: string;
      directory?: string;
      metadata?: Record<string, string>;
      minSize?: number;
      maxSize?: number;
      extension?: string;
    },
    includeMetadata = false,
  ): any {
    let results = this.listFiles(mantaray, true);

    if (fileName) {
      results = results.filter((file: any) => path.posix.basename(file.path).includes(fileName));
    }

    if (directory) {
      results = results.filter((file: any) => path.posix.dirname(file.path).includes(directory));
    }

    if (metadata) {
      results = results.filter((file: any) => {
        for (const [key, value] of Object.entries(metadata)) {
          if (file.metadata?.[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    if (minSize !== undefined && maxSize !== undefined) {
      results = results.filter((file: any) => {
        const size = parseInt(file.metadata?.['Content-Size'] ?? '0', 10); // Default to '0' if undefined
        return size >= minSize && size <= maxSize;
      });
    }

    if (extension) {
      const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
      results = results.filter((file: any) => {
        const cleanPath = file.path.split('\x00').join(''); // Clean up any null characters
        return path.posix.extname(cleanPath) === normalizedExtension;
      });
    }

    return results.map((file: any) => (includeMetadata ? file : { path: file.path }));
  }

  listFiles(mantaray: MantarayNode, includeMetadata = false): any {
    console.log('Listing files in Mantaray...');

    const fileList = [];
    const stack = [{ node: mantaray, path: '' }];

    while (stack.length > 0) {
      const item = stack.pop();
      if (!item) continue;
      const { node, path: currentPath } = item;
      const forks = node.forks;

      if (!forks) continue;

      for (const [key, fork] of Object.entries(forks)) {
        const prefix = fork.prefix ? decodeBytesToPath(fork.prefix) : key || 'unknown'; // Decode path
        const fullPath = path.join(currentPath, prefix);

        if (fork.node.isValueType()) {
          const metadata = fork.node.getMetadata || {};
          let originalPath = fullPath;

          if (metadata['Custom-Metadata']) {
            try {
              const customMetadata = JSON.parse(metadata['Custom-Metadata']);
              originalPath = customMetadata.fullPath || fullPath;
            } catch (e) {
              console.warn(`Invalid metadata JSON for ${fullPath}, using default path.`);
            }
          }

          // Conditionally include metadata
          const fileEntry = includeMetadata ? { metadata, path: originalPath } : { path: originalPath };

          fileList.push(fileEntry);
        } else {
          stack.push({ node: fork.node, path: fullPath });
        }
      }
    }

    return fileList;
  }

  private getDirectoryStructure(mantaray: MantarayNode, rootDirName: string): any {
    console.log('Building directory structure from Mantaray...');

    const structure = this.buildDirectoryStructure(mantaray);

    const wrappedStructure = {
      [rootDirName]: structure,
    };

    return wrappedStructure;
  }

  private buildDirectoryStructure(mantaray: MantarayNode): any {
    console.log('Building raw directory structure...');

    const structure: { [key: string]: any } = {};
    const fileList = this.listFiles(mantaray);

    for (const file of fileList) {
      const filePath = file.path;
      const relativePath = path.posix.normalize(filePath);
      const dirPath = path.posix.dirname(relativePath);
      const fileName = path.posix.basename(relativePath);

      let currentDir = structure;
      if (dirPath === '.' || dirPath === '') {
        currentDir[fileName] = null;
      } else {
        const dirParts = dirPath.split('/');
        for (const dir of dirParts) {
          if (!currentDir[dir]) {
            currentDir[dir] = {};
          }
          currentDir = currentDir[dir];
        }

        currentDir[fileName] = null;
      }
    }

    return structure;
  }

  getContentsOfDirectory(targetPath: string, mantaray: MantarayNode, rootDirName: string): any {
    const directoryStructure: { [key: string]: any } = this.getDirectoryStructure(mantaray, rootDirName);

    if (targetPath === rootDirName || targetPath === '.') {
      const rootContents = Object.keys(directoryStructure[rootDirName] || {});
      console.log(`Contents of root directory '${rootDirName}':`, rootContents);
      return rootContents;
    }

    const normalizedTargetPath = path.posix.normalize(targetPath);

    const rootDirectory = directoryStructure[rootDirName];
    if (!rootDirectory) {
      console.error(`[ERROR] Root directory '${rootDirName}' not found.`);
      return [];
    }

    // Recursive helper function to locate the target directory
    const findDirectory = (currentDir: any, currentPath: string): string | null => {
      if (currentPath === normalizedTargetPath || currentPath === `./${normalizedTargetPath}`) {
        return currentDir;
      }

      for (const key in currentDir) {
        const newPath = path.posix.join(currentPath, key);

        if (typeof currentDir[key] === 'object') {
          const result = findDirectory(currentDir[key], newPath);
          if (result) return result;
        }
      }

      return null;
    };

    const targetDirectory = findDirectory(rootDirectory, '');

    if (!targetDirectory) {
      console.error(`[ERROR] Directory not found: ${targetPath}`);
      return [];
    }

    const contents = Object.keys(targetDirectory);
    console.log(`Contents of '${targetPath}':`, contents);

    return contents;
  }

  // Start owner mantaray feed handler methods
  private async saveMantarayFeedList(): Promise<void> {
    const ownerFeedStamp = this.getOwnerFeedStamp();
    if (!ownerFeedStamp) {
      throw 'Owner feed stamp is not found.';
    }

    try {
      const mantarayFeedListData = await this.bee.uploadData(
        ownerFeedStamp.batchID,
        JSON.stringify(this.mantarayFeedList),
        {
          act: true,
        },
      );

      const ownerFeedData: ReferenceWithHistory = {
        reference: mantarayFeedListData.reference,
        historyRef: mantarayFeedListData.historyAddress,
      };
      console.log('bagoy first init ownerFeedData.reference: ', ownerFeedData.reference);
      console.log('bagoy first init ownerFeedData.historyRef: ', ownerFeedData.historyRef);

      const ownerFeedWriter = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, this.ownerFeedTopic, this.signer);
      const ownerFeedRawData = await this.bee.uploadData(ownerFeedStamp.batchID, JSON.stringify(ownerFeedData));
      const writeResult = await ownerFeedWriter.upload(ownerFeedStamp.batchID, ownerFeedRawData.reference, {
        index: this.nextOwnerFeedIndex,
      });
      const checkData = await ownerFeedWriter.download();
      console.log('bagoy checkData: ', checkData);

      console.log('bagoy first init ownerFeedRawData.reference: ', ownerFeedRawData.reference);
      this.nextOwnerFeedIndex += 1;
      console.log('Owner feed list updated: ', writeResult.reference);
    } catch (error: any) {
      throw `Failed to update owner feed list: ${error}`;
    }
  }
  // End owner mantaray feed handler methods

  // Start grantee handler methods
  // fetches the list of grantees who can access the file reference
  async getGranteesOfFile(eFileRef: string): Promise<GetGranteesResult> {
    const mf = this.mantarayFeedList.find((f) => f.eFileRef === eFileRef);
    if (mf?.eGranteeRef === undefined) {
      throw `Grantee list not found for file reference: ${eFileRef}`;
    }

    return this.bee.getGrantees(mf.eGranteeRef);
  }

  // TODO: only add is supported
  // updates the list of grantees who can access the file reference under the history reference
  private async handleGrantees(
    fileInfo: FileInfo,
    grantees: {
      add?: string[];
      revoke?: string[];
    },
    eGlRef?: string | Reference,
  ): Promise<GranteesResult> {
    console.log('Granting access to file: ', fileInfo.eFileRef);
    const fIx = this.fileInfoList.findIndex((f) => f.eFileRef === fileInfo.eFileRef);
    if (fIx === -1) {
      throw `Provided file reference not found: ${fileInfo.eFileRef}`;
    }

    let grantResult: GranteesResult;
    if (eGlRef !== undefined) {
      // TODO: history ref should be optional in bee-js
      grantResult = await this.bee.patchGrantees(
        fileInfo.batchId,
        eGlRef,
        fileInfo.historyRef || SWARM_ZERO_ADDRESS,
        grantees,
      );
      console.log('Access patched, grantee list reference: ', grantResult.ref);
    } else {
      if (grantees.add === undefined || grantees.add.length === 0) {
        throw `No grantees specified.`;
      }

      grantResult = await this.bee.createGrantees(fileInfo.batchId, grantees.add);
      console.log('Access granted, new grantee list reference: ', grantResult.ref);
    }

    return grantResult;
  }

  // End grantee handler methods

  // Start share methods
  subscribeToSharedInbox(topic: string, callback?: (data: ShareItem) => void): PssSubscription {
    console.log('Subscribing to shared inbox, topic: ', topic);
    this.sharedSubscription = this.bee.pssSubscribe(topic, {
      onMessage: (message) => {
        console.log('Received shared inbox message: ', message);
        assertShareItem(message);
        this.sharedWithMe.push(message);
        if (callback) {
          callback(message);
        }
      },
      onError: (e) => {
        console.log('Error received in shared inbox: ', e.message);
        throw e;
      },
    });

    return this.sharedSubscription;
  }

  unsubscribeFromSharedInbox(): void {
    if (this.sharedSubscription) {
      console.log('Unsubscribed from shared inbox, topic: ', this.sharedSubscription.topic);
      this.sharedSubscription.cancel();
    }
  }

  async shareItem(fileInfo: FileInfo, targetOverlays: string[], recipients: string[], message?: string): Promise<void> {
    const mfIx = this.mantarayFeedList.findIndex((mf) => mf.reference === fileInfo.eFileRef);
    if (mfIx === -1) {
      console.log('File reference not found in mantaray feed list.');
      return;
    }

    const grantResult = await this.handleGrantees(
      fileInfo,
      { add: recipients },
      this.mantarayFeedList[mfIx].eGranteeRef,
    );

    this.mantarayFeedList[mfIx] = {
      ...this.mantarayFeedList[mfIx],
      eGranteeRef: grantResult.ref,
    };

    this.saveMantarayFeedList();

    const item: ShareItem = {
      fileInfo: fileInfo,
      timestamp: Date.now(),
      message: message,
    };

    this.sendShareMessage(targetOverlays, item, recipients);
  }

  // recipient is optional, if not provided the message will be broadcasted == pss public key
  private async sendShareMessage(targetOverlays: string[], item: ShareItem, recipients: string[]): Promise<void> {
    if (recipients.length === 0 || recipients.length !== targetOverlays.length) {
      console.log('Invalid recipients or  targetoverlays specified for sharing.');
      return;
    }

    for (let i = 0; i < recipients.length; i++) {
      try {
        // TODO: mining will take too long, 2 bytes are enough
        const target = Utils.makeMaxTarget(targetOverlays[i]);
        const msgData = new Uint8Array(Buffer.from(JSON.stringify(item)));
        this.bee.pssSend(item.fileInfo.batchId, SHARED_INBOX_TOPIC, target, msgData, recipients[i]);
      } catch (error: any) {
        console.log(`Failed to share item with recipient: ${recipients[i]}\n `, error);
      }
    }
  }
  // End share methods

  public async getFeedData(topic: string, address?: string, index?: number): Promise<FetchFeedUpdateResponse> {
    try {
      const feedReader = this.bee.makeFeedReader(DEFAULT_FEED_TYPE, topic, address || this.wallet.address);
      if (index !== undefined) {
        return await feedReader.download({ index: numberToFeedIndex(index) });
      }
      return await feedReader.download();
    } catch (error) {
      if (isNotFoundError(error)) {
        return { feedIndex: -1, feedIndexNext: (0).toString(), reference: SWARM_ZERO_ADDRESS as Reference };
      }
      throw error;
    }
  }
}
