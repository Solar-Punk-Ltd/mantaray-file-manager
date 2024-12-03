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

  async uploadFile(file, mantaray, stamp) {
    console.log(`Uploading file: ${file}`);
    const fileData = readFileSync(file);
    console.log(`File content: ${fileData.toString('utf-8')}`); // Log the content for clarity
    const fileName = path.basename(file);
    const contentType = getContentType(fileName);
    console.log(`File name: ${fileName}, Content-Type: ${contentType}`);

    const uploadResponse = await this.bee.uploadFile(stamp, fileData, fileName);
    console.log(`File uploaded with reference: ${uploadResponse.reference}`);

    this.addToMantaray(mantaray, uploadResponse.reference, {
      Filename: fileName,
      'Content-Type': contentType,
    });
    return uploadResponse.reference;
  }

  addToMantaray(mantaray, reference, metadata = {}) {
    const filePath = metadata.Filename || 'file';
    const bytesPath = encodePathToBytes(filePath);
    const formattedReference = hexStringToReference(reference);
    console.log(`Adding file to Mantaray: ${filePath}, Reference: ${reference}`);
    mantaray.addFork(bytesPath, formattedReference);
  }

  async saveMantaray(mantaray, stamp) {
    console.log('Saving Mantaray manifest...');
    const manifestReference = await mantaray.save(async (data) => {
      console.log(`saveMantaray: uploading data of length ${data.length}...`);
      const uploadResults = await this.bee.uploadData(stamp, data);
      console.log(`Uploaded Mantaray data. Reference: ${uploadResults.reference}`);
      return hexStringToReference(uploadResults.reference);
    });
    console.log(`Mantaray manifest saved. Uint8Array Reference: ${manifestReference}`);
    return Buffer.from(manifestReference).toString('hex');
  }

  listFiles(mantaray, currentPath = '') {
    console.log('Listing files in Mantaray...');
    const files = [];
    const forks = mantaray.forks;
  
    if (!forks) {
      console.log('No forks found in Mantaray node.');
      return files;
    }
  
    for (const fork of Object.values(forks)) {
      const prefixBytes = fork.prefix || new Uint8Array(); // Handle undefined prefixes
      const prefix = decodeBytesToPath(prefixBytes);
      const fullPath = path.join(currentPath, prefix).replace(/\\/g, '/'); // Normalize path separators
  
      console.log(`Processing prefix: ${prefix}`);
      if (fork.node.isValueType()) {
        console.log(`File found: ${fullPath}`);
        files.push(fullPath);
      } else {
        console.log(`Descending into directory: ${fullPath}`);
        files.push(...this.listFiles(fork.node, fullPath));
      }
    }
    console.log(`Files in Mantaray: ${files}`);
    return files;
  }  

  async downloadFile(mantaray, filePath) {
    console.log(`Downloading file: ${filePath}`);
    const files = this.listFiles(mantaray);
    if (!files.includes(filePath)) {
      console.error(`File not found in Mantaray: ${filePath}`);
      throw new Error(`File not found in Mantaray: ${filePath}`);
    }

    const normalizedPath = path.normalize(filePath);
    const segments = normalizedPath.split(path.sep);
    let currentNode = mantaray;

    for (const segment of segments) {
      const segmentBytes = encodePathToBytes(segment);
      console.log(`Processing segment: ${segment}`);
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

    try {
      const fileData = await this.bee.downloadFile(hexReference);
      console.log(`Downloaded content: ${fileData.data.toString('utf-8')}`);
      return fileData.data ? Buffer.from(fileData.data).toString('utf-8').trim() : '';
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
      console.log(`Processing prefix: ${prefix}`);
      const fileReference = fork.node.getEntry;

      if (fork.node.isValueType() && fileReference) {
        const hexReference = Buffer.from(fileReference).toString('hex');
        console.log(`Downloading file with reference: ${hexReference}`);
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
}

module.exports = FileManager;
