const { Bee } = require('@ethersphere/bee-js');
const { MantarayNode } = require('mantaray-js');
const { getContentType, encodePathToBytes, decodeBytesToPath, hexStringToReference } = require('./utils');
const { readFileSync } = require('fs');
const path = require('path');

class FileManager {
  constructor(beeUrl) {
    if (!beeUrl) {
      throw new Error('Bee URL is required for initializing the FileManager.');
    }
    console.log('Initializing Bee client...');
    this.bee = new Bee(beeUrl);
    this.mantaray = new MantarayNode();
    this.importedFiles = [];
  }

  async initialize(items) {
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
    } catch (error) {
      console.error(`[ERROR] Failed to import references: ${error.message}`);
      throw error;
    }
  }
  
  async importReferences(referenceList, isLocal = false) {
    const processPromises = referenceList.map(async (item) => {
      const reference = isLocal ? item.hash : item;
      try {
        const binaryReference = hexStringToReference(reference);
        console.log(`Processing reference: ${reference}`);
  
        // Download the file to extract its metadata
        const fileData = await this.bee.downloadFile(reference);
        const content = Buffer.from(fileData.data || '');
        const fileName = fileData.headers?.['filename'] || `pinned-${reference.substring(0, 6)}`;
        const contentType = fileData.headers?.['content-type'] || 'application/octet-stream';
        const contentSize = content.length;
  
        // Build metadata dynamically based on the downloaded file
        const metadata = {
          'Content-Type': contentType,
          'Content-Size': contentSize.toString(),
          'Time-Uploaded': new Date().toISOString(),
          'Filename': fileName,
          'Custom-Metadata': JSON.stringify({
            description: `Imported file: ${fileName}`,
            tags: ['imported', 'simulation', isLocal ? 'local' : 'pinned'],
          }),
          pinned: true,
        };
  
        console.log(`Adding Reference: ${reference} as ${fileName}`);
        // Add the file to the Mantaray node with enriched metadata
        this.addToMantaray(undefined, binaryReference, metadata);
  
        // Track imported files
        this.importedFiles.push({ reference, filename: fileName });
      } catch (error) {
        console.error(`[ERROR] Failed to process reference ${reference}: ${error.message}`);
      }
    });
  
    await Promise.all(processPromises); // Wait for all references to be processed
  }
  
  async importPinnedReferences() {
    const allPins = await this.bee.getAllPins();
    await this.importReferences(allPins);
  }
  
  async importLocalReferences(items) {
    await this.importReferences(items, true);
  }
  
  async downloadFile(mantaray, filePath) {
    mantaray = mantaray || this.mantaray;
    console.log(`Downloading file: ${filePath}`);
    const normalizedPath = path.normalize(filePath);
    const segments = normalizedPath.split(path.sep);
    let currentNode = mantaray;

    for (const segment of segments) {
      const segmentBytes = encodePathToBytes(segment);
      const fork = Object.values(currentNode.forks || {}).find(
        (f) => Buffer.compare(f.prefix, segmentBytes) === 0
      );

      if (!fork) throw new Error(`Path segment not found: ${segment}`);
      currentNode = fork.node;
    }

    if (!currentNode.isValueType()) {
      throw new Error(`Path does not point to a file: ${filePath}`);
    }

    const fileReference = currentNode.getEntry;
    const hexReference = Buffer.from(fileReference).toString('hex');
    console.log(`Downloading file with reference: ${hexReference}`);

    const metadata = currentNode.metadata || {};
    try {
      const fileData = await this.bee.downloadFile(hexReference);
      return {
        data: fileData.data ? Buffer.from(fileData.data).toString('utf-8').trim() : '',
        metadata,
      };
    } catch (error) {
      console.error(`Error downloading file ${filePath}:`, error.message);
      throw error;
    }
  }

  async downloadFiles(mantaray) {
    mantaray = mantaray || this.mantaray;
    console.log('Downloading all files from Mantaray...');
    const forks = mantaray.forks;
    if (!forks) {
      console.log('No forks found in Mantaray.');
      return undefined; // Explicitly return undefined when there are no forks
    }
  
    const downloadPromises = [];
  
    for (const fork of Object.values(forks)) {
      const prefix = decodeBytesToPath(fork.prefix || []);
      const fileReference = fork.node.getEntry;
  
      if (fork.node.isValueType() && fileReference) {
        const hexReference = Buffer.from(fileReference).toString('hex');
        const metadata = fork.metadata || {};
  
        downloadPromises.push(
          this.bee.downloadFile(hexReference).then((fileData) => {
            console.log(
              `Contents of ${prefix}: ${Buffer.from(fileData.data).toString('utf-8')}`
            );
            return {
              path: prefix,
              data: Buffer.from(fileData.data).toString('utf-8'),
              metadata,
            };
          }).catch((error) => {
            console.error(`Error downloading file ${prefix}:`, error.message);
            return null; // Return null for failed downloads
          })
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

  async uploadFile(file, mantaray, stamp, customMetadata = {}, redundancyLevel = '1', save = true) {
    mantaray = mantaray || this.mantaray;
    console.log(`Uploading file: ${file}`);
    const fileData = readFileSync(file);
    const fileName = path.basename(file);
    const contentType = getContentType(file);
  
    const metadata = {
      'Content-Type': contentType,
      'Content-Size': fileData.length.toString(),
      'Time-Uploaded': new Date().toISOString(),
      'Filename': fileName,
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
    } catch (error) {
      console.error(`[ERROR] Failed to upload file ${file}: ${error.message}`);
      throw error;
    }
  }  

  addToMantaray(mantaray, reference, metadata = {}) {
    mantaray = mantaray || this.mantaray;
    const filePath = metadata.Filename || 'file';
    metadata.Filename = filePath;
    const bytesPath = encodePathToBytes(filePath);
    const formattedReference = hexStringToReference(reference);

    console.log(`Adding file to Mantaray: ${filePath}, Reference: ${reference}`);
    mantaray.addFork(bytesPath, formattedReference, { ...metadata });
  }

  async saveMantaray(mantaray, stamp) {
    mantaray = mantaray || this.mantaray;
    console.log('Saving Mantaray manifest...');
    const manifestReference = await mantaray.save(async (data) => {
      const fileName = 'manifest';
      const contentType = 'application/json';
      const uploadResponse = await this.bee.uploadFile(stamp, data, fileName, { contentType });
      return hexStringToReference(uploadResponse.reference);
    });

    const hexReference = Buffer.from(manifestReference).toString('hex');
    console.log(`Mantaray manifest saved with reference: ${hexReference}`);
    return hexReference;
  }

  listFiles(mantaray, currentPath = '', includeMetadata = false) {
    mantaray = mantaray || this.mantaray;
    console.log('Listing files in Mantaray...');
  
    const files = [];
    const stack = [{ node: mantaray, path: currentPath }];
    const pathSeparator = '/';
  
    while (stack.length > 0) {
      const { node, path: currentPath } = stack.pop();
      const forks = node.forks;
  
      if (!forks) continue;
  
      for (const fork of Object.values(forks)) {
        const prefixBytes = fork.prefix || new Uint8Array();
        const prefix = prefixBytes.length > 0 ? decodeBytesToPath(prefixBytes) : '';
        const fullPath = currentPath + (currentPath && prefix ? pathSeparator : '') + prefix;
  
        if (fork.node.isValueType()) {
          files.push(
            includeMetadata
              ? { path: fullPath, metadata: fork.node.metadata || {} }
              : { path: fullPath }
          );
        } else {
          stack.push({ node: fork.node, path: fullPath });
        }
      }
    }
  
    return files;
  }  
}

module.exports = FileManager;
