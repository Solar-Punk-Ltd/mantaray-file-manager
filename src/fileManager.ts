import { BatchId, Bee, Reference, Utils } from '@ethersphere/bee-js';
import { readFileSync } from 'fs';
import { MantarayNode, MetadataMapping, Reference as MantarayRef } from 'mantaray-js';
import path from 'path';

import { DEFAULT_FEED_TYPE, FileMetadata } from './types';
import { encodePathToBytes, getContentType } from './utils';

export class FileManager {
  // TODO: private vars
  public bee: Bee;
  public mantaray: MantarayNode;
  public importedFiles: FileMetadata[];

  constructor(beeUrl: string) {
    if (!beeUrl) {
      throw new Error('Bee URL is required for initializing the FileManager.');
    }
    console.log('Initializing Bee client...');
    this.bee = new Bee(beeUrl);
    this.mantaray = new MantarayNode();
    this.importedFiles = [];

    // Create personalized feed
  }

  async intializeMantarayUsingFeed() {
    //
  }

  async loadMantaray(manifestReference: Reference) {
    const loadFunction = async (address: MantarayRef): Promise<Uint8Array> => {
      return this.bee.downloadData(Utils.bytesToHex(address));
    };

    this.mantaray.load(loadFunction, Utils.hexToBytes(manifestReference));
  }

  // TODO: Implement this method
  async updateStampData(topic: string, privateKey: string) {
    const fw = this.bee.makeFeedWriter(DEFAULT_FEED_TYPE, topic, privateKey);
  }

  async getUsableStamps() {
    try {
      const stamps = await this.bee.getAllPostageBatch();
      return stamps.filter((s) => s.usable);
    } catch (error) {
      console.error(`Failed to get usable stamps: ${error}`);
      return [];
    }
  }

  async initialize(items: any | undefined) {
    console.log('Importing references...');
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

  async importReferences(referenceList: Reference[], isLocal = false) {
    const processPromises = referenceList.map(async (item: any) => {
      const mantarayRef: MantarayRef = isLocal ? item.hash : item;
      const reference = Utils.bytesToHex(mantarayRef);
      try {
        console.log(`Processing reference: ${reference}`);

        // Download the file to extract its metadata
        const fileData = await this.bee.downloadFile(reference);
        const content = Buffer.from(fileData.data || '');
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
        this.importedFiles.push({ reference, name: fileName });
      } catch (error: any) {
        console.error(`[ERROR] Failed to process reference ${reference}: ${error.message}`);
      }
    });

    await Promise.all(processPromises); // Wait for all references to be processed
  }

  async importPinnedReferences() {
    const allPins = await this.bee.getAllPins();
    await this.importReferences(allPins);
  }

  async importLocalReferences(items: any) {
    await this.importReferences(items, true);
  }

  async downloadFile(mantaray: MantarayNode, filePath: string) {
    mantaray = mantaray || this.mantaray;
    console.log(`Downloading file: ${filePath}`);
    const normalizedPath = path.normalize(filePath);
    const segments = normalizedPath.split(path.sep);
    let currentNode = mantaray;

    for (const segment of segments) {
      const segmentBytes = encodePathToBytes(segment);
      const fork = Object.values(currentNode.forks || {}).find((f) => Buffer.compare(f.prefix, segmentBytes) === 0);

      if (!fork) throw new Error(`Path segment not found: ${segment}`);
      currentNode = fork.node;
    }

    if (!currentNode.isValueType()) {
      throw new Error(`Path does not point to a file: ${filePath}`);
    }

    const fileReference = currentNode.getEntry;
    if (!fileReference) throw new Error(`File reference not found for path: ${filePath}`);
    const hexReference = Utils.bytesToHex(fileReference);
    console.log(`Downloading file with reference: ${hexReference}`);

    const metadata = currentNode.getMetadata || {};
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

  async downloadFiles(mantaray: MantarayNode) {
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

  async uploadFile(
    file: string,
    mantaray: MantarayNode | undefined,
    stamp: string | BatchId,
    customMetadata = {},
    redundancyLevel = '1',
    save = true,
  ) {
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
      contentType,
      headers: {
        'swarm-redundancy-level': redundancyLevel,
      },
    };

    try {
      const uploadResponse = await this.bee.uploadFile(stamp, fileData, fileName, uploadHeaders);
      this.addToMantaray(mantaray, uploadResponse.reference, metadata);

      if (save) {
        console.log('Saving Mantaray node...');
        await this.saveMantaray(mantaray, stamp);
      }

      console.log(`File uploaded successfully: ${file}, Reference: ${uploadResponse.reference}`);
      return uploadResponse.reference;
    } catch (error: any) {
      console.error(`[ERROR] Failed to upload file ${file}: ${error.message}`);
      throw error;
    }
  }

  addToMantaray(mantaray: MantarayNode | undefined, reference: string, metadata: MetadataMapping = {}) {
    mantaray = mantaray || this.mantaray;

    const filePath = metadata.fullPath || metadata.Filename || 'file';
    const originalFileName = metadata.originalFileName || path.basename(filePath);

    const bytesPath = encodePathToBytes(filePath);

    const metadataWithOriginalName = {
      ...metadata,
      Filename: originalFileName, // Use the original filename here
    };

    mantaray.addFork(bytesPath, Utils.hexToBytes(reference), metadataWithOriginalName);
  }

  async saveMantaray(mantaray: MantarayNode | undefined, stamp: string | BatchId) {
    mantaray = mantaray || this.mantaray;
    console.log('Saving Mantaray manifest...');

    const saveFunction = async (data: Uint8Array): Promise<MantarayRef> => {
      const fileName = 'manifest';
      const contentType = 'application/json';
      const uploadResponse = await this.bee.uploadFile(stamp, data, fileName, { contentType });
      return Utils.hexToBytes(uploadResponse.reference);
    };

    const manifestReference = await mantaray.save(saveFunction);

    const hexReference = Buffer.from(manifestReference).toString('hex');
    console.log(`Mantaray manifest saved with reference: ${hexReference}`);
    return hexReference;
  }

  listFiles(mantaray: MantarayNode | undefined, includeMetadata = false) {
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
        const prefix = fork.prefix ? Utils.bytesToHex(fork.prefix) : key || 'unknown';
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

          const fileEntry = { metadata, path: originalPath };
          if (includeMetadata) {
            fileEntry.metadata = metadata;
          }

          fileList.push(fileEntry);
        } else {
          stack.push({ node: fork.node, path: fullPath });
        }
      }
    }

    return fileList;
  }

  getDirectoryStructure(mantaray: MantarayNode | undefined, rootDirName: string) {
    mantaray = mantaray || this.mantaray;
    console.log('Building directory structure from Mantaray...');

    const structure = this.buildDirectoryStructure(mantaray);

    const wrappedStructure = {
      [rootDirName]: structure,
    };

    return wrappedStructure;
  }

  buildDirectoryStructure(mantaray: MantarayNode) {
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

  getContentsOfDirectory(targetPath: string, mantaray: MantarayNode | undefined, rootDirName: string) {
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
}
