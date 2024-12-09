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
  }

  createMantarayNode() {
    console.log('Creating a new MantarayNode...');
    return new MantarayNode();
  }

  async uploadFile(file, mantaray, stamp, customMetadata = {}, redundancyLevel = '1') {
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
    console.log(`File uploaded with reference: ${uploadResponse.reference}`);

    this.addToMantaray(mantaray, uploadResponse.reference, metadata);
    return uploadResponse.reference;
  }

  addToMantaray(mantaray, reference, metadata = {}) {
    const filePath = metadata.Filename || 'file';
    metadata.Filename = filePath; // Ensure Filename is always included in metadata
    const bytesPath = encodePathToBytes(filePath);
    const formattedReference = hexStringToReference(reference);
  
    console.log(`Adding file to Mantaray: ${filePath}, Reference: ${reference}`);
    mantaray.addFork(bytesPath, formattedReference, { ...metadata }); // Use spread operator to prevent overwrites
  }  

  async saveMantaray(mantaray, stamp) {
    console.log('Saving Mantaray manifest...');
    const manifestReference = await mantaray.save(async (data) => {
      const fileName = 'manifest';
      const contentType = 'application/json';
      const uploadResponse = await this.bee.uploadFile(stamp, data, fileName, { contentType });
      console.log(`Uploaded Mantaray manifest with reference: ${uploadResponse.reference}`);
      return this.hexStringToReference(uploadResponse.reference);
    });

    const hexReference = Buffer.from(manifestReference).toString('hex');
    console.log(`Mantaray manifest saved with reference: ${hexReference}`);
    return hexReference;
  }

  listFiles(mantaray, currentPath = '', includeMetadata = false) {
    console.log('Listing files in Mantaray...');
    const files = [];
    const forks = mantaray.forks;
  
    if (!forks) {
      console.log('No forks found in Mantaray node.');
      return files;
    }
  
    for (const fork of Object.values(forks)) {
      const prefixBytes = fork.prefix || new Uint8Array();
      const prefix = prefixBytes.length > 0 ? decodeBytesToPath(prefixBytes) : ''; // Handle undefined prefixes
      const fullPath = path.join(currentPath, prefix).replace(/\\/g, '/');
  
      console.log(`Processing prefix: ${prefix}`);
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
    console.log(`Files in Mantaray: ${JSON.stringify(files)}`);
    return files;
  }  

  async downloadFile(mantaray, filePath) {
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
      console.log(`Downloaded content: ${fileData.data.toString('utf-8')}`);
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
    console.log('Downloading all files from Mantaray...');
    const forks = mantaray.forks;
    if (!forks) return;

    for (const fork of Object.values(forks)) {
      const prefix = decodeBytesToPath(fork.prefix || []);
      const fileReference = fork.node.getEntry;

      if (fork.node.isValueType() && fileReference) {
        const hexReference = Buffer.from(fileReference).toString('hex');
        const metadata = fork.metadata || {};
        console.log(`Downloading file with reference: ${hexReference}`);
        try {
          const fileData = await this.bee.downloadFile(hexReference);
          console.log(`Contents of ${prefix}: ${Buffer.from(fileData.data).toString('utf-8')}`);
          console.log(`Metadata for ${prefix}: ${JSON.stringify(metadata)}`);
        } catch (error) {
          console.error(`Error downloading file ${prefix}:`, error.message);
        }
      } else if (!fork.node.isValueType()) {
        console.log(`Descending into directory: ${prefix}`);
        await this.downloadFiles(fork.node);
      }
    }
  }

  encodePathToBytes(filePath) {
    return new TextEncoder().encode(filePath);
  }

  hexStringToReference(hex) {
    return new Uint8Array(Buffer.from(hex, 'hex'));
  }
}

module.exports = FileManager;
