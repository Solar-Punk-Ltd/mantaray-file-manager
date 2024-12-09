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

  async initialize() {
    console.log('Importing pinned references...');
    try {
      await this.importPinnedReferences();
      console.log('Pinned references imported successfully.');
    } catch (error) {
      console.error(`[ERROR] Failed to import pinned references: ${error.message}`);
      throw error;
    }
  }

  async importPinnedReferences() {
    const allPins = await this.bee.getAllPins();
    console.log('Mock Pins Returned:', allPins);

    const pinnedReferences = Object.values(allPins).filter(
      (ref) => typeof ref === 'string' && ref.length === 64
    );

    console.log('Filtered Pinned References:', pinnedReferences);

    for (const pinReference of pinnedReferences) {
      const binaryReference = hexStringToReference(pinReference);
      const fileName = `pinned-${pinReference.substring(0, 6)}`;
      console.log(`Adding Reference: ${pinReference} as ${fileName}`);
      this.addToMantaray(undefined, binaryReference, {
        pinned: true,
        Filename: fileName,
      });
      this.importedFiles.push({ reference: pinReference, filename: fileName });
    }
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
    if (!forks) return;

    for (const fork of Object.values(forks)) {
      const prefix = decodeBytesToPath(fork.prefix || []);
      const fileReference = fork.node.getEntry;

      if (fork.node.isValueType() && fileReference) {
        const hexReference = Buffer.from(fileReference).toString('hex');
        const metadata = fork.metadata || {};
        try {
          const fileData = await this.bee.downloadFile(hexReference);
          console.log(`Contents of ${prefix}: ${Buffer.from(fileData.data).toString('utf-8')}`);
        } catch (error) {
          console.error(`Error downloading file ${prefix}:`, error.message);
        }
      } else if (!fork.node.isValueType()) {
        console.log(`Descending into directory: ${prefix}`);
        await this.downloadFiles(fork.node);
      }
    }
  }

  async uploadFile(file, mantaray, stamp, customMetadata = {}, redundancyLevel = '1') {
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

    const uploadResponse = await this.bee.uploadFile(stamp, fileData, fileName, uploadHeaders);
    this.addToMantaray(mantaray, uploadResponse.reference, metadata);
    return uploadResponse.reference;
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
    const forks = mantaray.forks;

    if (!forks) {
      return files;
    }

    for (const fork of Object.values(forks)) {
      const prefixBytes = fork.prefix || new Uint8Array();
      const prefix = prefixBytes.length > 0 ? decodeBytesToPath(prefixBytes) : '';
      const fullPath = path.join(currentPath, prefix).replace(/\\/g, '/');

      if (fork.node.isValueType()) {
        const fileEntry = { path: fullPath };
        if (includeMetadata) {
          fileEntry.metadata = fork.node.metadata || {};
        }
        files.push(fileEntry);
      } else {
        files.push(...this.listFiles(fork.node, fullPath, includeMetadata));
      }
    }
    return files;
  }
}

module.exports = FileManager;
