import {
  BatchId,
  Bee,
  BeeRequestOptions,
  Data,
  ENCRYPTED_REFERENCE_HEX_LENGTH,
  FileUploadOptions,
  GranteesResult,
  PostageBatch,
  PssSubscription,
  RedundancyLevel,
  Reference,
  REFERENCE_HEX_LENGTH,
  UploadRedundancyOptions,
  Utils,
} from '@ethersphere/bee-js';
import { MantarayNode, MetadataMapping, Reference as MantarayRef } from '@solarpunkltd/mantaray-js';
import { Wallet } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';

import {
  DEFAULT_FEED_TYPE,
  METADATA_TOPIC,
  OWNER_FEED_STAMP_LABEL,
  REFERENCE_LIST_TOPIC,
  SHARED_INBOX_TOPIC,
} from './constants';
import { MetadataFile, OwnerFeedData, SharedMessage } from './types';
import { assertSharedMessage, decodeBytesToPath, encodePathToBytes, getContentType } from './utils';

export class FileManager {
  // TODO: private vars
  // TODO: store shared refs and own files in the same array ?
  public bee: Bee;
  public mantaray: MantarayNode;
  public importedFiles: MetadataFile[];

  private stampList: PostageBatch[];
  private metadataFileList: MetadataFile[];
  private nextOwnerFeedIndex: string;
  private wallet: Wallet;
  private privateKey: string;
  private granteeLists: string[];
  private sharedWithMe: SharedMessage[];
  private sharedSubscription: PssSubscription;
  private address: string;
  // TODO: is this.mantaray needed ? always a new mantaray instance is created when wokring on an item
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
    this.stampList = [];
    this.metadataFileList = [];
    this.nextOwnerFeedIndex = '';
    this.privateKey = privateKey;
    this.wallet = new Wallet(privateKey);
    this.address = this.wallet.address;
    this.topic = this.bee.makeFeedTopic(REFERENCE_LIST_TOPIC);

    this.mantaray = new MantarayNode();
    this.importedFiles = [];
    this.granteeLists = [];
    this.sharedWithMe = [];
    this.sharedSubscription = {} as PssSubscription;
  }

  // Start init methods
  // TODO: use allSettled for file fetching and only save the ones that are successful
  async initialize(items: any | undefined): Promise<void> {
    try {
      this.sharedSubscription = this.subscribeToSharedInbox();
    } catch (error: any) {
      console.log('Error during shared inbox subscription: ', error);
    }

    try {
      console.log('Importing stamps...');
      await this.initStamps();
    } catch (error: any) {
      console.error(`[ERROR] Failed to initialize stamps: ${error.message}`);
      throw error;
    }

    try {
      console.log('Importing metadata of files...');
      await this.initMetadataFileList();
    } catch (error: any) {
      console.error(`[ERROR] Failed to initialize file metadata: ${error.message}`);
      throw error;
    }

    // if stamp is not found than the file cannot be downloaded? is this necessary ??
    for (const stamp of this.stampList) {
      const mtdtIx = this.metadataFileList.findIndex((f) => stamp.batchID === f.batchId);
      if (mtdtIx === undefined) {
        this.metadataFileList.splice(mtdtIx, 1);
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

  // TODO: import other stamps in order to topup: owner(s) ?
  async initStamps(): Promise<void> {
    try {
      this.stampList = await this.getUsableStamps();
      console.log('Usable stamps fetched successfully.');
    } catch (error: any) {
      console.error(`Failed to fetch stamps: ${error}`);
      throw error;
    }
  }

  // TODO: shared file feed similarly
  // TODO: util func to make options for act headers
  async initMetadataFileList(): Promise<void> {
    const topicHex = this.bee.makeFeedTopic(REFERENCE_LIST_TOPIC);
    const feedReader = this.bee.makeFeedReader(DEFAULT_FEED_TYPE, topicHex, this.address);
    try {
      const latestFeedData = await feedReader.download();
      this.nextOwnerFeedIndex = latestFeedData.feedIndexNext;

      const ownerFeedRawData = await this.bee.downloadData(latestFeedData.reference);
      const ownerFeedData = JSON.parse(JSON.stringify(ownerFeedRawData)) as OwnerFeedData;
      const options: BeeRequestOptions = {
        headers: { 'swarm-act-history-address': ownerFeedData.history, 'swarm-act-publisher': this.address },
      } as const;
      // TODO: act encrpyt the metadatalist refs??
      const metadataList = JSON.parse(
        (await this.bee.downloadData(ownerFeedData.metadataListReference, options)).text(),
      ) as MetadataFile[];
      for (const mtdt of metadataList) {
        const metadata = JSON.parse((await this.bee.downloadData(mtdt.reference)).text()) as MetadataFile;
        this.metadataFileList.push(metadata);
      }
      console.log('Stamps fetched from feed.');
    } catch (error: any) {
      console.error(`Failed to fetch stamps from feed: ${error}`);
      return;
    }
  }
  // End init methods

  async loadMantaray(manifestReference: Reference): Promise<void> {
    const loadFunction = async (address: MantarayRef): Promise<Uint8Array> => {
      return this.bee.downloadData(Utils.bytesToHex(address));
    };

    await this.mantaray.load(loadFunction, Utils.hexToBytes(manifestReference));
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
      return Utils.hexToBytes(uploadResponse.reference) as Utils.Bytes<64>; // Ensure 64-byte reference
    });

    const hexManifestReference = Utils.bytesToHex(manifestReference, 128); // Ensure hex string length is 128

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

    const reader = this.bee.makeFeedReader('sequence', this.topic, this.wallet.address);
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
      return undefined;
    } catch (error: any) {
      console.error(`Failed to get stamp with batchID ${batchId}: ${error.message}`);
      return undefined;
    }
  }
  // End stamp methods

  // TODO: only download metadata files for listing -> only download the whole file on demand
  async importReferences(referenceList: Reference[], batchId?: string, isLocal = false): Promise<void> {
    const processPromises = referenceList.map(async (item: any) => {
      const reference: Reference = isLocal ? item.hash : item;
      try {
        console.log(`Processing reference: ${reference}`);

        // Download the file to extract its metadata

        // TODO: act headers
        const options: BeeRequestOptions = {};
        // if (file.reference.length === ENCRYPTED_REFERENCE_HEX_LENGTH) {
        //   if (file.historyRef !== undefined) {
        //     options.headers = { 'swarm-act-history-address': file.historyRef };
        //   }
        //   if (file.owner !== undefined) {
        //     options.headers = {
        //       ...options.headers,
        //       'swarm-act-publisher': file.owner,
        //     };
        //   }
        //   if (file.timestamp !== undefined) {
        //     options.headers = { ...options.headers, 'swarm-act-timestamp': file.timestamp.toString() };
        //   }
        // }
        // TODO: maybe use path to get the rootmetadata and store it locally
        const path = '/rootmetadata.json';
        const fileData = await this.bee.downloadFile(reference, path, options);
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
        // TODO: eglref, shared, timestamp -> mantaray root metadata
        this.importedFiles.push({ reference: reference, name: fileName, batchId: batchId, shared: undefined });
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
    await this.importReferences(items, undefined, true);
  }

  async downloadFile(mantaray: MantarayNode, filePath: string, onlyMetadata = false): Promise<object> {
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

    const hexReference = Utils.bytesToHex(fileReference);
    console.log(`Downloading file with reference: ${hexReference}`);

    try {
      const fileData = await this.bee.downloadFile(hexReference);
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

  // TODO: always upload with ACT, only adding the publisher as grantee first (by defualt), then when shared, add the grantees
  // TODO: store filerefs with the historyrefs
  async uploadFile(
    file: string,
    mantaray: MantarayNode | undefined,
    batchId: string | BatchId,
    customMetadata = {},
    redundancyLevel = RedundancyLevel.MEDIUM,
  ): Promise<string> {
    mantaray = mantaray || this.mantaray;
    console.log(`Uploading file: ${file}`);
    const fileData = readFileSync(file);
    const fileName = path.basename(file);
    const contentType = getContentType(file);

    const metadata = {
      'Content-Type': contentType,
      'Content-Size': fileData.length.toString(),
      'Time-Uploaded': new Date().toISOString(),
      Filename: fileName,
      'Custom-Metadata': JSON.stringify(customMetadata),
    };

    const uploadHeaders = {
      contentType: contentType,
      act: true,
      redundancyLevel: redundancyLevel,
    } as FileUploadOptions & UploadRedundancyOptions;

    try {
      const uploadResponse = await this.bee.uploadFile(batchId, fileData, fileName, uploadHeaders);
      this.addToMantaray(mantaray, uploadResponse.reference, metadata);

      const metadataFile = {
        reference: uploadResponse.reference,
        batchId: batchId,
        name: fileName,
        owner: this.address,
        historyRef: uploadResponse.historyAddress,
        timestamp: new Date().getTime(),
        eGlRef: undefined,
      } as MetadataFile;

      // TODO: always update everything with the same redundancy level ??
      try {
        const uploadMetadataResponse = await this.bee.uploadFile(
          batchId,
          JSON.stringify(metadataFile),
          'metadata.json',
          {
            contentType: 'application/json',
            act: true,
            redundancyLevel: redundancyLevel,
          },
        );
        const topicHex = this.bee.makeFeedTopic(uploadMetadataResponse.reference);
        const feedWriter = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, topicHex, this.privateKey);

        const uploadResult = await this.bee.uploadData(batchId, uploadMetadataResponse.historyAddress);
        const feedWriteResult = await feedWriter.upload(batchId, uploadResult.reference, {
          index: undefined, // todo: keep track of the latest index ??
          act: true,
        });

        console.log('File metadata feed updated: ', feedWriteResult.reference);
        this.addToMantaray(mantaray, feedWriteResult.reference, metadata);
      } catch (error: any) {
        console.error(`Failed to update file metadata feed: ${error}`);
      }

      // TODO: wrapped mantaray
      await this.updateWrappedMantaray();
      this.metadataFileList.push(metadataFile);

      console.log('Saving Mantaray node...');
      const { eRef, hRef } = await this.saveMantaray(mantaray, batchId);

      await this.updateMetadataFileList(hRef);

      console.log(`File uploaded successfully: ${file}, Reference: ${eRef}`);
      return eRef;
    } catch (error: any) {
      console.error(`[ERROR] Failed to upload file ${file}: ${error.message}`);
      throw error;
    }
  }

  addToMantaray(mantaray: MantarayNode | undefined, reference: string, metadata: MetadataMapping = {}): void {
    mantaray = mantaray || this.mantaray;

    const filePath = metadata.fullPath || metadata.Filename || 'file';
    const originalFileName = metadata.originalFileName || path.basename(filePath);

    const bytesPath = Utils.hexToBytes(filePath);

    const metadataWithOriginalName = {
      ...metadata,
      Filename: originalFileName, // Use the original filename here
    };

    mantaray.addFork(bytesPath, Utils.hexToBytes(reference), metadataWithOriginalName);
  }

  // TODO: problem: mantary impl. is old and does not return the history address
  async saveMantaray(mantaray: MantarayNode | undefined, stamp: string | BatchId): Promise<any> {
    mantaray = mantaray || this.mantaray;
    console.log('Saving Mantaray manifest...');

    const saveFunction = async (data: Uint8Array): Promise<MantarayRef> => {
      const fileName = 'manifest';
      const contentType = 'application/json';
      const uploadResponse = await this.bee.uploadFile(stamp, data, fileName, {
        contentType,
        act: true,
      });
      return Utils.hexToBytes(uploadResponse.reference);
    };

    const manifestReference = Utils.bytesToHex(await mantaray.save(saveFunction));

    console.log(`Mantaray manifest saved with reference: ${manifestReference}`);
    return { eRef: manifestReference, hRef: saveResult.historyAddress };
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
  ) {
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
  async updateWrappedMantaray(): Promise<string | undefined> {}

  async updateMetadataFileList(): Promise<void> {
    const ownerFeedStamp = await this.getOwnerFeedStamp();
    if (!ownerFeedStamp) {
      console.error('Owner feed stamp is not found.');
      return;
    }

    const ownerFeedTopicHex = this.bee.makeFeedTopic(REFERENCE_LIST_TOPIC);
    const ownerFeedWriter = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, ownerFeedTopicHex, this.privateKey);
    try {
      const uploadResult = await this.bee.uploadData(ownerFeedStamp.batchID, JSON.stringify(this.metadataFileList), {
        act: true,
      });
      const ownerFeedData = {
        history: uploadResult.historyAddress,
        metadataListReference: uploadResult.reference,
      } as OwnerFeedData;
      const ownerFeedRawDataUploadResult = await this.bee.uploadData(
        ownerFeedStamp.batchID,
        JSON.stringify(ownerFeedData),
      );
      const writeResult = await ownerFeedWriter.upload(ownerFeedStamp.batchID, ownerFeedRawDataUploadResult.reference, {
        index: this.nextOwnerFeedIndex,
      });
      console.log('Metdata and owner feed updated: ', writeResult.reference);
    } catch (error: any) {
      console.error(`Failed to update metdata and owner feed: ${error}`);
      return;
    }
  }
  // Start feed handler methods

  // Start grantee methods
  // fetches the list of grantees under the given reference
  async getGrantees(eGlRef: string | Reference): Promise<string[] | undefined> {
    if (eGlRef.length !== REFERENCE_HEX_LENGTH) {
      console.error('Invalid reference: ', eGlRef);
      return;
    }

    try {
      // TODO: parse data as ref array
      const grantResult = await this.bee.getGrantees(eGlRef);
      const grantees = grantResult.data;
      const granteeList = this.granteeLists.find((glref) => glref === eGlRef);
      if (granteeList !== undefined) {
        this.granteeLists.push(eGlRef);
      }
      console.log('Grantees fetched: ', grantees);
      return grantees;
    } catch (error: any) {
      console.error(`Failed to get share grantee list: ${error}`);
      return undefined;
    }
  }

  // TODO: do not store encrypted grantee ref in the wrapedd mantaray just in the owner mtdt feed
  // fetches the list of grantees who can access the file reference
  async getGranteesOfFile(fileRef: string | Reference): Promise<string[] | undefined> {
    const file = this.metadataFileList.find((f) => f.reference === fileRef);
    if (file === undefined || file.eGlRef === undefined) {
      console.error('File or grantee ref not found for reference: ', fileRef);
      return undefined;
    }
    return await this.getGrantees(file.eGlRef);
  }

  // TODO: separate revoke function or frontend will handle it by creating a new act ?
  // TODO: create a feed just like for the stamps to store the grantee list refs
  // TODO: create a feed for the share access that can be read by each grantee
  // TODO: notify user if it has been granted access by someone else
  // TODO: stamp of the file vs grantees stamp?
  // updates the list of grantees who can access the file reference under the history reference
  async handleGrantees(
    batchId: string | BatchId,
    file: MetadataFile,
    grantees: {
      add?: string[];
      revoke?: string[];
    },
    historyRef: string | Reference,
    eGlRef?: string | Reference,
  ): Promise<GranteesResult | undefined> {
    console.log('Allowing grantees to share files with me');

    try {
      let grantResult: GranteesResult;
      if (eGlRef !== undefined && eGlRef.length === REFERENCE_HEX_LENGTH) {
        grantResult = await this.bee.patchGrantees(batchId, eGlRef, historyRef, grantees);
        console.log('Access patched, grantee list reference: ', grantResult.ref);
      } else {
        if (grantees.add === undefined || grantees.add.length === 0) {
          console.error('No grantees specified.');
          return undefined;
        }

        grantResult = await this.bee.createGrantees(batchId, grantees.add);
        console.log('Access granted, new grantee list reference: ', grantResult.ref);
      }

      // TODO: how to handle sharing: base fileref remains but the latest & encrypted ref that is shared changes -> versioning ??
      const currentGranteesIx = this.granteeLists.findIndex((glref) => glref === file.eGlRef);
      if (currentGranteesIx === -1) {
        this.granteeLists.push(grantResult.ref);
      } else {
        this.granteeLists[currentGranteesIx] = grantResult.ref;
        // TODO: maybe don't need to check if upload + patch happens at the same time -> add to import ?
        const fIx = this.importedFiles.findIndex((f) => f.reference === file.reference);
        if (fIx === -1) {
          console.log('Provided file reference not found in imported files: ', file.reference);
          return undefined;
        } else {
          this.importedFiles[fIx].eGlRef = grantResult.ref;
        }
      }

      console.log('Grantees updated: ', grantResult);
      return grantResult;
    } catch (error: any) {
      console.error(`Failed to grant share access: ${error}`);
      return undefined;
    }
  }
  // End grantee methods

  // Start share methods
  subscribeToSharedInbox(): PssSubscription {
    return this.bee.pssSubscribe(SHARED_INBOX_TOPIC, {
      onMessage: (message) => {
        console.log('Received shared inbox message: ', message);
        assertSharedMessage(message);
        this.sharedWithMe.push(message);
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
  // TODO: history handling ? -> bee-js: is historyref mandatory ? patch can create a granteelist and update it in place
  async shareItems(
    batchId: string,
    references: Reference[],
    targetOverlays: string[],
    recipients: string[],
    message?: string,
  ): Promise<void> {
    try {
      const historyRefs = new Array<string>(references.length);
      for (let i = 0; i < references.length; i++) {
        const ref = references[i];
        const file = this.importedFiles.find((f) => f.reference === ref);
        if (file === undefined) {
          console.log('File not found for reference: ', ref);
          continue;
        }
        if (file.historyRef === undefined) {
          console.log('History not found for reference: ', ref);
          continue;
        }
        // TODO: how to update file metadata with new eglref ? -> filemetadata = /feed/decryptedref/metadata
        const grantResult = await this.handleGrantees(
          batchId,
          { reference: ref },
          { add: recipients },
          file.historyRef,
          file.eGlRef,
        );

        if (grantResult !== undefined) {
          const feedMetadatRef = await this.updateFileMetadata({
            ...file,
            eGlRef: grantResult.ref,
            historyRef: grantResult.historyref,
          });

          if (feedMetadatRef !== undefined) {
            historyRefs[i] = grantResult.historyref;
          } else {
            console.log('Failed to update file metadata: ', ref);
          }
        }
      }

      const item = {
        owner: this.address,
        references: historyRefs,
        timestamp: Date.now(),
        message: message,
      } as SharedMessage;

      await this.sendShareMessage(batchId, targetOverlays, item, recipients);
    } catch (error: any) {
      console.log('Failed to share items: ', error);
      return undefined;
    }
  }

  // recipient is optional, if not provided the message will be broadcasted == pss public key
  async sendShareMessage(
    batchId: string,
    targetOverlays: string[],
    item: SharedMessage,
    recipients: string[],
  ): Promise<void> {
    // TODO: valid length check of recipient and target
    if (recipients.length === 0 || recipients.length !== targetOverlays.length) {
      console.log('Invalid recipients or  targetoverlays specified for sharing.');
      return undefined;
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
  async downloadSharedItem(file: MetadataFile, path?: string): Promise<Data | undefined> {
    if (!this.sharedWithMe.find((msg) => msg.references.includes(file.reference))) {
      console.log('Cannot find reference in shared messages: ', file.reference);
      return undefined;
    }

    const options: BeeRequestOptions = {};
    if (file.reference.length === ENCRYPTED_REFERENCE_HEX_LENGTH) {
      if (file.historyRef !== undefined) {
        options.headers = { 'swarm-act-history-address': file.historyRef };
      }
      if (file.owner !== undefined) {
        options.headers = {
          ...options.headers,
          'swarm-act-publisher': file.owner,
        };
      }
      if (file.timestamp !== undefined) {
        options.headers = { ...options.headers, 'swarm-act-timestamp': file.timestamp.toString() };
      }
    }

    try {
      // TODO: publisher and history headers
      const data = await this.bee.downloadFile(file.reference, path, options);
      return data.data;
    } catch (error: any) {
      console.error(`Failed to download shared file ${file.reference}\n: ${error}`);
      return undefined;
    }
  }
  // End share methods
}
