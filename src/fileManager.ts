import {
  BatchId,
  Bee,
  BeeRequestOptions,
  Data,
  GranteesResult,
  PostageBatch,
  PssSubscription,
  RedundancyLevel,
  Reference,
  REFERENCE_HEX_LENGTH,
  Signer,
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
import { FileInfo, ReferenceWithHistory, ShareItem, WrappedMantarayFeed } from './types';
import {
  assertShareItem,
  decodeBytesToPath,
  encodePathToBytes,
  getContentType,
  makeBeeRequestOptions,
  makeNumericIndex,
  numberToFeedIndex,
} from './utils';

export class FileManager {
  // TODO: private vars
  public bee: Bee;
  // TODO: is this.mantaray needed ? always a new mantaray instance is created when wokring on an item
  public mantaray: MantarayNode;

  private wallet: Wallet;
  private signer: Signer;
  private importedReferences: string[];
  private stampList: PostageBatch[];
  private mantarayFeedList: WrappedMantarayFeed[];
  private fileInfoList: FileInfo[];
  private nextOwnerFeedIndex: number;
  private granteeLists: WrappedMantarayFeed[];
  private sharedWithMe: ShareItem[];
  private sharedSubscription: PssSubscription;
  private topic: string;

  constructor(beeUrl: string, privateKey: string) {
    if (!beeUrl) {
      throw new Error('Bee URL is required for initializing the FileManager.');
    }
    if (!privateKey) {
      throw new Error('privateKey is required for initializing the FileManager.');
    }

    console.log('Initializing Bee client...');
    this.bee = new Bee(beeUrl);
    this.sharedSubscription = this.subscribeToSharedInbox();
    this.wallet = new Wallet(privateKey);
    this.signer = {
      address: Utils.hexToBytes(this.wallet.address.slice(2)),
      sign: async (data: Data): Promise<string> => {
        return await this.wallet.signMessage(data);
      },
    };
    this.mantaray = initManifestNode();
    this.stampList = [];
    this.importedReferences = [];
    this.fileInfoList = [];
    this.mantarayFeedList = [];
    this.nextOwnerFeedIndex = -1;
    this.topic = '';
    this.granteeLists = [];
    this.sharedWithMe = [];
  }

  // Start init methods
  // TODO: use allSettled for file fetching and only save the ones that are successful
  async initialize(items: any | undefined): Promise<void> {
    this.initOwnerTopic();

    try {
      console.log('Importing stamps...');
      await this.initStamps();
    } catch (error: any) {
      console.error(`[ERROR] Failed to initialize stamps: ${error.message}`);
      throw error;
    }

    try {
      console.log('Importing metadata of files...');
      await this.initFileInfoList();
    } catch (error: any) {
      console.error(`[ERROR] Failed to initialize file metadata: ${error.message}`);
      throw error;
    }

    // if stamp is not found than the file cannot be downloaded? is this necessary ??
    for (const stamp of this.stampList) {
      const ix = this.fileInfoList.findIndex((f) => stamp.batchID === f.batchId);
      if (ix === undefined) {
        this.fileInfoList.splice(ix, 1);
      }
    }

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
      throw error;
    }
  }

  async initOwnerTopic(): Promise<void> {
    try {
      const topicHex = this.bee.makeFeedTopic(REFERENCE_LIST_TOPIC);
      const fw = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, topicHex, this.wallet.address);
      const topicData = await fw.download({ index: numberToFeedIndex(0) });
      if (makeNumericIndex(topicData.feedIndexNext) === 0) {
        const ownerFeedStamp = await this.getOwnerFeedStamp();
        if (ownerFeedStamp === undefined) {
          console.log('Owner stamp not found');
          return;
        }
        this.topic = Utils.bytesToHex(randomBytes(TOPIC_HEX_LENGTH), TOPIC_HEX_LENGTH);
        const topicDataRes = await this.bee.uploadData(ownerFeedStamp.batchID, this.topic, { act: true });
        await fw.upload(ownerFeedStamp.batchID, topicDataRes.reference, { index: numberToFeedIndex(0) });
        await fw.upload(ownerFeedStamp.batchID, topicDataRes.historyAddress as Reference, {
          index: numberToFeedIndex(1),
        });
      } else {
        const topicHistory = await fw.download({ index: numberToFeedIndex(1) });
        const options = makeBeeRequestOptions(topicHistory.reference, this.wallet.address);
        this.topic = Utils.bytesToHex(await this.bee.downloadData(topicData.reference, options));
      }
    } catch (error: any) {
      console.log('error reading owner topic feed: ', error);
      throw error;
    }
  }

  async initStamps(): Promise<void> {
    try {
      this.stampList = await this.getUsableStamps();
      console.log('Usable stamps fetched successfully.');
    } catch (error: any) {
      console.error(`Failed to fetch stamps: ${error}`);
      throw error;
    }
  }

  // TODO: refactor initFileInfoList
  // async fetchWrappedFeedData(
  //   topic: string,
  //   address: string,
  //   index?: number,
  //   options?: BeeRequestOptions,
  // ): Promise<any> {
  //   const reader = this.bee.makeFeedReader(DEFAULT_FEED_TYPE, topic, address);
  //   const refFeedData = await reader.download({ index: numberToFeedIndex(index) });
  // }

  // TODO: shared file feed similarly
  async initFileInfoList(): Promise<void> {
    try {
      const ownerFR = this.bee.makeFeedReader(DEFAULT_FEED_TYPE, this.topic, this.wallet.address);
      const latestFeedData = await ownerFR.download();
      this.nextOwnerFeedIndex = makeNumericIndex(latestFeedData.feedIndexNext);

      const ownerFeedRawData = await this.bee.downloadData(latestFeedData.reference);
      const ownerFeedData = JSON.parse(ownerFeedRawData.text()) as ReferenceWithHistory;

      const options = makeBeeRequestOptions(ownerFeedData.historyRef, this.wallet.address);
      const mantarayFeedList = (await this.bee.downloadData(ownerFeedData.reference, options)).text();
      this.mantarayFeedList = JSON.parse(mantarayFeedList) as ReferenceWithHistory[];

      for (const mantaryFeedItem of this.mantarayFeedList) {
        const wrappedMantarayFR = this.bee.makeFeedReader(
          DEFAULT_FEED_TYPE,
          mantaryFeedItem.reference,
          this.wallet.address,
        );
        // TODO: donwload encrypted file info data
        const wrappedMantarayData = await wrappedMantarayFR.download();
        let options = makeBeeRequestOptions(mantaryFeedItem.historyRef, this.wallet.address);
        const wrappedMantarayRef = (
          await this.bee.downloadData(wrappedMantarayData.reference, options)
        ).hex() as Reference;

        await this.loadMantaray(wrappedMantarayRef, this.mantaray);
        const fileInfoFork = this.mantaray.getForkAtPath(encodePathToBytes(FILEIINFO_PATH));
        const fileInfoRef = fileInfoFork?.node.getEntry;
        if (fileInfoRef === undefined) {
          console.log("object doesn't have a fileinfo entry, ref: ", wrappedMantarayRef);
          continue;
        }

        const histsoryFork = this.mantaray.getForkAtPath(encodePathToBytes(FILEINFO_HISTORY_PATH));
        const historyRef = histsoryFork?.node.getEntry;
        if (historyRef === undefined) {
          console.log("object doesn't have a history entry, ref: ", wrappedMantarayRef);
          continue;
        }
        options = makeBeeRequestOptions(historyRef, this.wallet.address);
        const fileInfo = JSON.parse(JSON.stringify(await this.bee.downloadData(fileInfoRef, options))) as FileInfo;
        this.fileInfoList.push(fileInfo);
      }
      console.log('Stamps fetched from feed.');
    } catch (error: any) {
      console.error(`Failed to fetch stamps from feed: ${error}`);
    }
  }
  // End init methods

  async loadMantaray(manifestReference: Reference, mantaray: MantarayNode | undefined): Promise<void> {
    mantaray = mantaray || this.mantaray;
    const loadFunction = async (address: Reference): Promise<Uint8Array> => {
      return this.bee.downloadData(address);
    };

    await mantaray.load(loadFunction, manifestReference);
  }

  async initializeFeed(stamp: string | BatchId): Promise<void> {
    console.log('Initializing wallet and checking for existing feed...');

    const reader = this.bee.makeFeedReader('sequence', this.topic, this.wallet.address);

    try {
      const { reference } = await reader.download();
      console.log(`Existing feed found. Reference: ${reference}`);

      const manifestData = await this.bee.downloadData(reference);
      this.mantaray.deserialize(Buffer.from(manifestData));
      console.log('Mantaray structure initialized from feed.');
    } catch (error) {
      console.log('No existing feed found. Initializing new Mantaray structure...');
      this.mantaray = new MantarayNode();
      await this.saveFeed(stamp);
    }
  }

  async saveFeed(stamp: string | BatchId): Promise<void> {
    console.log('Saving Mantaray structure to feed...');

    // Save the Mantaray structure and get the manifest reference (Uint8Array)
    const manifestReference = await this.mantaray.save(async (data) => {
      const uploadResponse = await this.bee.uploadData(stamp, data);
      return uploadResponse.reference; // Ensure 64-byte reference
    });

    if (manifestReference.length === 64) manifestReference.padEnd(128, '0'); // Ensure hex string length is 128
    const hexManifestReference = manifestReference;

    // Create a feed writer and upload the manifest reference
    const writer = this.bee.makeFeedWriter('sequence', this.topic, this.wallet.privateKey);
    await writer.upload(stamp, hexManifestReference as Reference); // Explicitly cast to Reference

    console.log(`Feed updated with reference: ${hexManifestReference}`);
  }

  async fetchFeed(): Promise<Reference> {
    console.log('Fetching the latest feed reference...');
    if (!this.wallet) {
      throw new Error('Wallet not initialized. Please call initializeFeed first.');
    }

    const reader = this.bee.makeFeedReader(DEFAULT_FEED_TYPE, this.topic, this.wallet.address);
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
  async getUsableStamps(): Promise<PostageBatch[]> {
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

  async getOwnerFeedStamp(): Promise<PostageBatch | undefined> {
    return this.stampList.find((s) => s.label === OWNER_FEED_STAMP_LABEL);
  }

  async getCachedStamp(batchId: string | BatchId): Promise<PostageBatch | undefined> {
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
  // End stamp methods

  async importReferences(referenceList: Reference[], isLocal = false): Promise<void> {
    const processPromises = referenceList.map(async (item: any) => {
      const reference: Reference = isLocal ? item.hash : item;
      try {
        console.log(`Processing reference: ${reference}`);

        // Download the file to extract its metadata

        // TODO: act headers
        // TODO: maybe use path to get the rootmetadata and store it locally
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
        this.addToMantaray(undefined, reference, metadata);

        // Track imported files
        this.importedReferences.push(reference);
      } catch (error: any) {
        console.error(`[ERROR] Failed to process reference ${reference}: ${error.message}`);
      }
    });

    await Promise.all(processPromises); // Wait for all references to be processed
  }

  async importPinnedReferences(): Promise<void> {
    const allPins = await this.bee.getAllPins();
    await this.importReferences(allPins);
  }

  async importLocalReferences(items: any): Promise<void> {
    await this.importReferences(items, undefined);
  }

  async downloadFile(
    mantaray: MantarayNode,
    filePath: string,
    onlyMetadata = false,
    options?: BeeRequestOptions,
  ): Promise<object> {
    mantaray = mantaray || this.mantaray;
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
    mantaray = mantaray || this.mantaray;
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

  async download(fileRef: string): Promise<object> {
    // TODO: connect downdloadfile with fileinfolist and wrappee mantaray feed
    return {};
  }

  async upload(
    batchId: string | BatchId,
    mantaray: MantarayNode | undefined,
    file: string,
    customMetadata: Record<string, string> = {},
    refAsTopicHex: string | undefined = undefined,
    redundancyLevel = RedundancyLevel.MEDIUM,
  ): Promise<void> {
    mantaray = mantaray || this.mantaray;

    const uploadFileRes = await this.uploadFile(batchId, file, redundancyLevel);

    const fileInfo = {
      fileRef: uploadFileRes.reference,
      batchId: batchId,
      fileName: path.basename(file),
      owner: this.wallet.address,
      shared: false,
      historyRef: uploadFileRes.historyRef,
      timestamp: new Date().getTime(),
      customMetadata: customMetadata,
    } as FileInfo;

    const fileInfoRes = await this.uploadFileInfo(batchId, fileInfo, redundancyLevel);
    mantaray.addFork(encodePathToBytes(FILEIINFO_PATH), fileInfoRes.reference as Reference, {
      'Content-Type': 'application/json',
      Filename: FILEIINFO_NAME,
    });

    const uploadHistoryRef = await this.uploadFileInfoHistory(batchId, fileInfoRes.historyRef);
    mantaray.addFork(encodePathToBytes(FILEINFO_HISTORY_PATH), uploadHistoryRef as Reference, {
      'Content-Type': 'application/json',
      Filename: FILEINFO_HISTORY_NAME,
    });

    let wrappedMantarayRef: string;
    try {
      wrappedMantarayRef = await this.saveMantaray(batchId, mantaray);
    } catch (error: any) {
      console.error(`Failed to save wrapped mantaray: ${error}`);
      throw error;
    }

    const topicHex = refAsTopicHex || this.bee.makeFeedTopic(wrappedMantarayRef);
    const wrappedMantarayHistory = await this.updateWrappedMantarayFeed(batchId, wrappedMantarayRef, topicHex);

    await this.saveFileInfoList({
      reference: topicHex,
      historyRef: wrappedMantarayHistory,
    });
  }

  private async uploadFile(
    batchId: string | BatchId,
    file: string,
    redundancyLevel = RedundancyLevel.MEDIUM,
  ): Promise<ReferenceWithHistory> {
    console.log(`Uploading file: ${file}`);
    const fileData = readFileSync(file);
    const fileName = path.basename(file);
    const contentType = getContentType(file);

    try {
      const uploadFileRes = await this.bee.uploadFile(batchId, fileData, fileName, {
        act: true,
        redundancyLevel: redundancyLevel,
        contentType: contentType,
      });

      console.log(`File uploaded successfully: ${file}, Reference: ${uploadFileRes.reference}`);
      return { reference: uploadFileRes.reference, historyRef: uploadFileRes.historyAddress };
    } catch (error: any) {
      console.error(`Failed to upload file ${file}: ${error.message}`);
      throw error;
    }
  }

  private async uploadFileInfo(
    batchId: string | BatchId,
    fileInfo: FileInfo,
    redundancyLevel: RedundancyLevel = RedundancyLevel.MEDIUM,
  ): Promise<ReferenceWithHistory> {
    try {
      const uploadInfoRes = await this.bee.uploadData(batchId, JSON.stringify(fileInfo), {
        act: true,
        redundancyLevel: redundancyLevel,
      });
      console.log('Fileinfo updated: ', uploadInfoRes.reference);

      this.fileInfoList.push(fileInfo);

      return { reference: uploadInfoRes.reference, historyRef: uploadInfoRes.historyAddress };
    } catch (error: any) {
      console.error(`Failed to save fileinfo: ${error}`);
      throw error;
    }
  }

  private async uploadFileInfoHistory(
    batchId: string | BatchId,
    hisoryRef: string,
    redundancyLevel: RedundancyLevel = RedundancyLevel.MEDIUM,
  ): Promise<string> {
    try {
      const uploadHistoryRes = await this.bee.uploadData(batchId, hisoryRef, {
        redundancyLevel: redundancyLevel,
      });

      console.log('Fileinfo history updated: ', uploadHistoryRes.reference);

      return uploadHistoryRes.reference;
    } catch (error: any) {
      console.error(`Failed to save fileinfo history: ${error}`);
      throw error;
    }
  }

  private async updateWrappedMantarayFeed(
    batchId: string | BatchId,
    wrappedMantarayRef: string,
    topicHex: string,
  ): Promise<string> {
    try {
      // TODO: test if feed ACT up/down actually works !!!
      const wrappedMantarayFw = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, topicHex, this.signer);
      const wrappedMantarayData = await this.bee.uploadData(batchId, wrappedMantarayRef, { act: true });
      await wrappedMantarayFw.upload(batchId, wrappedMantarayData.reference, {
        index: undefined, // todo: keep track of the latest index ??
      });

      return wrappedMantarayData.historyAddress;
    } catch (error: any) {
      console.error(`Failed to save owner info feed: ${error}`);
      throw error;
    }
  }

  addToMantaray(mantaray: MantarayNode | undefined, reference: string, metadata: MetadataMapping = {}): void {
    mantaray = mantaray || this.mantaray;

    const filePath = metadata.fullPath || metadata.Filename || 'file';
    const originalFileName = metadata.originalFileName || path.basename(filePath);

    const bytesPath = encodePathToBytes(filePath);

    const metadataWithOriginalName = {
      ...metadata,
      Filename: originalFileName, // Use the original filename here
    };

    mantaray.addFork(bytesPath, reference as Reference, metadataWithOriginalName);
  }

  async saveMantaray(batchId: string | BatchId, mantaray: MantarayNode | undefined): Promise<string> {
    mantaray = mantaray || this.mantaray;
    console.log('Saving Mantaray manifest...');

    const saveFunction = async (data: Uint8Array): Promise<Reference> => {
      const uploadResponse = await this.bee.uploadData(batchId, data);
      return uploadResponse.reference;
    };

    const manifestReference = await mantaray.save(saveFunction);
    console.log(`Mantaray manifest saved, reference: ${manifestReference}`);
    return manifestReference;
  }

  searchFilesByName(fileNameQuery: string, includeMetadata = false): any {
    console.log(`Searching for files by name: ${fileNameQuery}`);

    const allFiles = this.listFiles(this.mantaray, includeMetadata);

    const filteredFiles = allFiles.filter((file: any) => file.path.includes(fileNameQuery));

    return filteredFiles;
  }

  searchFiles(
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
    let results = this.listFiles(this.mantaray, true);

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

  listFiles(mantaray: MantarayNode | undefined, includeMetadata = false): any {
    mantaray = mantaray || this.mantaray;
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

  getDirectoryStructure(mantaray: MantarayNode | undefined, rootDirName: string): any {
    mantaray = mantaray || this.mantaray;
    console.log('Building directory structure from Mantaray...');

    const structure = this.buildDirectoryStructure(mantaray);

    const wrappedStructure = {
      [rootDirName]: structure,
    };

    return wrappedStructure;
  }

  buildDirectoryStructure(mantaray: MantarayNode): any {
    mantaray = mantaray || this.mantaray;
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

  getContentsOfDirectory(targetPath: string, mantaray: MantarayNode | undefined, rootDirName: string): any {
    mantaray = mantaray || this.mantaray;

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

  // Start feed handler methods
  async saveFileInfoList(feedUpdate: WrappedMantarayFeed): Promise<void> {
    const ownerFeedStamp = await this.getOwnerFeedStamp();
    if (!ownerFeedStamp) {
      throw 'Owner feed stamp is not found.';
    }

    const ix = this.mantarayFeedList.findIndex((f) => f.reference === feedUpdate.reference);
    if (ix !== -1) {
      this.mantarayFeedList[ix] = feedUpdate;
    } else {
      this.mantarayFeedList.push(feedUpdate);
    }

    const ownerFeedWriter = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, this.topic, this.signer);
    try {
      const mantarayFeedListData = await this.bee.uploadData(
        ownerFeedStamp.batchID,
        JSON.stringify(this.mantarayFeedList),
        {
          act: true,
        },
      );
      const ownerFeedData = {
        reference: mantarayFeedListData.reference,
        historyRef: mantarayFeedListData.historyAddress,
      } as ReferenceWithHistory;
      const ownerFeedRawData = await this.bee.uploadData(ownerFeedStamp.batchID, JSON.stringify(ownerFeedData));
      const writeResult = await ownerFeedWriter.upload(ownerFeedStamp.batchID, ownerFeedRawData.reference, {
        index: numberToFeedIndex(this.nextOwnerFeedIndex),
      });
      this.nextOwnerFeedIndex += 1;
      console.log('Metdata and owner feed updated: ', writeResult.reference);
    } catch (error: any) {
      console.error(`Failed to update metdata and owner feed: ${error}`);
      throw error;
    }
  }
  // Start feed handler methods

  // Start grantee methods
  // fetches the list of grantees under the given reference
  async getGrantees(eGlRef: string | Reference): Promise<string[]> {
    if (eGlRef.length !== REFERENCE_HEX_LENGTH) {
      throw `Invalid reference: ${eGlRef}`;
    }

    const grantResult = await this.bee.getGrantees(eGlRef);
    const grantees = grantResult.data;
    const granteeList = this.granteeLists.find((gl) => gl.eGranteeRef === eGlRef);
    if (granteeList !== undefined) {
      this.granteeLists.push(granteeList);
    }
    console.log('Grantees fetched: ', grantees);
    return grantees;
  }

  // fetches the list of grantees who can access the file reference
  async getGranteesOfFile(fileRef: string | Reference): Promise<string[]> {
    const granteeList = this.granteeLists.find((f) => f.reference === fileRef);
    if (granteeList === undefined) {
      throw `Grantee list not found for file reference: ${fileRef}`;
    }

    const file = this.fileInfoList.find((f) => f.fileRef === fileRef);
    if (file === undefined || granteeList.eGranteeRef === undefined) {
      throw `File or grantee ref not found for reference: ${fileRef}`;
    }
    return await this.getGrantees(granteeList.eGranteeRef);
  }

  // TODO: as of not only add is supported
  // updates the list of grantees who can access the file reference under the history reference
  async handleGrantees(
    batchId: string | BatchId,
    file: FileInfo,
    grantees: {
      add?: string[];
      revoke?: string[];
    },
    eGlRef?: string | Reference,
  ): Promise<GranteesResult> {
    console.log('Granting access to file: ', file.fileRef);
    const fIx = this.fileInfoList.findIndex((f) => f.fileRef === file.fileRef);
    if (fIx === -1) {
      throw `Provided file reference not found: ${file.fileRef}`;
    }

    let grantResult: GranteesResult;
    if (eGlRef !== undefined) {
      // TODO: history ref should be optional in bee-js
      grantResult = await this.bee.patchGrantees(batchId, eGlRef, file.historyRef || SWARM_ZERO_ADDRESS, grantees);
      console.log('Access patched, grantee list reference: ', grantResult.ref);
    } else {
      if (grantees.add === undefined || grantees.add.length === 0) {
        throw `No grantees specified.`;
      }

      grantResult = await this.bee.createGrantees(batchId, grantees.add);
      console.log('Access granted, new grantee list reference: ', grantResult.ref);
    }

    const currentGranteesIx = this.granteeLists.findIndex((g) => g.eGranteeRef === eGlRef);
    const granteeInfo = {
      reference: file.fileRef,
      historyRef: grantResult.historyref,
      eGranteeRef: grantResult.ref,
    } as WrappedMantarayFeed;
    if (currentGranteesIx === -1) {
      this.granteeLists.push(granteeInfo);
    } else {
      this.granteeLists[currentGranteesIx] = granteeInfo;
    }

    console.log('Grantees updated: ', grantResult);
    return grantResult;
  }

  // private async saveGranteeList(grantee: GranteeReference) {
  //   const currentGranteesIx = this.granteeLists.findIndex((g) => g.eGlRef === eGlRef);
  //   const granteeInfo = {
  //     reference: file.fileRef,
  //     historyRef: grantResult.historyref,
  //     eGlRef: grantResult.ref,
  //   } as GranteeReference;
  //   if (currentGranteesIx === -1) {
  //     this.granteeLists.push(granteeInfo);
  //   } else {
  //     this.granteeLists[currentGranteesIx] = granteeInfo;
  //   }
  // }

  // End grantee methods

  // Start share methods
  // TODO: do we want to save the shared items on a feed ?
  subscribeToSharedInbox(): PssSubscription {
    return this.bee.pssSubscribe(SHARED_INBOX_TOPIC, {
      onMessage: (message) => {
        console.log('Received shared inbox message: ', message);
        assertShareItem(message);
        const msg = message as ShareItem;
        this.sharedWithMe.push(msg);
      },
      onError: (e) => {
        console.log('Error received in shared inbox: ', e.message);
        throw e;
      },
    });
  }

  // TODO: do we need to cancel sub at shutdown ?
  unsubscribeFromSharedInbox(): void {
    if (this.sharedSubscription) {
      console.log('Unsubscribed from shared inbox, topic: ', this.sharedSubscription.topic);
      this.sharedSubscription.cancel();
    }
  }

  // TODO: allsettled
  async shareItems(
    batchId: string,
    files: FileInfo[],
    targetOverlays: string[],
    recipients: string[],
    message?: string,
  ): Promise<void> {
    const fileRefs = files.map((f) => f.fileRef);
    try {
      for (let i = 0; i < fileRefs.length; i++) {
        const ref = fileRefs[i];
        const mf = this.mantarayFeedList.find((mf) => mf.reference === ref);
        if (mf === undefined) {
          throw 'File reference not found in mantaray feed list.';
        }

        const fileInfo = this.fileInfoList.find((f) => f.fileRef === ref);
        if (fileInfo === undefined) {
          console.log('File not found for reference: ', ref);
          continue;
        }

        const granteeRef = await this.handleGrantees(batchId, fileInfo, { add: recipients });

        await this.saveFileInfoList({
          reference: mf.reference,
          historyRef: mf.historyRef,
          eGranteeRef: granteeRef.ref,
        });
      }

      const item = {
        fileInfoList: files,
        timestamp: Date.now(),
        message: message,
      } as ShareItem;

      await this.sendShareMessage(batchId, targetOverlays, item, recipients);
    } catch (error: any) {
      console.log('Failed to share items: ', error);
    }
  }

  // recipient is optional, if not provided the message will be broadcasted == pss public key
  async sendShareMessage(
    batchId: string,
    targetOverlays: string[],
    item: ShareItem,
    recipients: string[],
  ): Promise<void> {
    // TODO: valid length check of recipient and target
    if (recipients.length === 0 || recipients.length !== targetOverlays.length) {
      console.log('Invalid recipients or  targetoverlays specified for sharing.');
      return;
    }

    for (let i = 0; i < recipients.length; i++) {
      try {
        const target = Utils.makeMaxTarget(targetOverlays[i]);
        const msgData = new Uint8Array(Buffer.from(JSON.stringify(item)));
        await this.bee.pssSend(batchId, SHARED_INBOX_TOPIC, target, msgData, recipients[i]);
      } catch (error: any) {
        console.log(`Failed to share item with recipient: ${recipients[i]}\n `, error);
      }
    }
  }
  // TODO: maybe store only the encrypted refs for security and use
  async downloadSharedItem(file: FileInfo, path?: string): Promise<Data | undefined> {
    const references = this.sharedWithMe.map((si) => si.fileInfoList.map((fi) => fi.fileRef)).flat();

    if (!references.includes(file.fileRef)) {
      console.log('Cannot find file reference in shared messages: ', file.fileRef);
      return;
    }

    const options = makeBeeRequestOptions(file.historyRef, file.owner, file.timestamp);

    try {
      // TODO: publisher and history headers
      const data = await this.bee.downloadFile(file.fileRef, path, options);
      return data.data;
    } catch (error: any) {
      console.error(`Failed to download shared file ${file.fileRef}\n: ${error}`);
    }
  }
  // End share methods
}
