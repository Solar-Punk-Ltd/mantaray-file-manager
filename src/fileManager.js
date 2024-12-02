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
    this.bee = new Bee(beeUrl);
  }

  createMantarayNode() {
    return new MantarayNode();
  }

  async uploadFile(file, mantaray, stamp) {
    const fileData = readFileSync(file);
    const fileName = path.basename(file); // Keep file name simple
    const contentType = getContentType(fileName);

    const uploadResponse = await this.bee.uploadFile(stamp, fileData, fileName);
    this.addToMantaray(mantaray, uploadResponse.reference, { Filename: fileName, 'Content-Type': contentType });
    return uploadResponse.reference;
  }

  addToMantaray(mantaray, reference, metadata = {}) {
    const filePath = metadata.Filename || 'file';
    const bytesPath = encodePathToBytes(filePath);
    mantaray.addFork(bytesPath, hexStringToReference(reference));
  }

  async saveMantaray(mantaray, stamp) {
    return await mantaray.save(async (data) => {
      const uploadResults = await this.bee.uploadData(stamp, data);
      return hexStringToReference(uploadResults.reference);
    });
  }

  listFiles(mantaray, currentPath = '') {
    const files = [];
    const forks = mantaray.forks;

    if (!forks) return files;

    for (const fork of Object.values(forks)) {
      const prefix = decodeBytesToPath(fork.prefix || []);
      const fullPath = path.join(currentPath, prefix);

      if (fork.node.isValueType()) {
        files.push(fullPath);
      } else {
        files.push(...this.listFiles(fork.node, `${fullPath}/`));
      }
    }
    return files;
  }

  async downloadFile(mantaray, filePath) {
    const files = this.listFiles(mantaray); // List all files
    if (!files.includes(filePath)) {
      throw new Error(`File not found in Mantaray: ${filePath}`);
    }
  
    const normalizedPath = path.normalize(filePath); // Normalize input path
    const bytesPath = encodePathToBytes(normalizedPath);
  
    let currentNode = mantaray;
    const segments = filePath.split(path.sep);
  
    for (const segment of segments) {
      const segmentBytes = encodePathToBytes(segment);
      const fork = Object.values(currentNode.forks || {}).find(
        (f) => Buffer.compare(f.prefix, segmentBytes) === 0
      );
  
      if (!fork) {
        throw new Error(`Path segment not found: ${segment}`);
      }
  
      currentNode = fork.node; // Descend into the node
    }
  
    if (!currentNode.isValueType()) {
      throw new Error(`Path does not point to a file: ${filePath}`);
    }
  
    const fileReference = currentNode.getEntry;
    const hexReference = Buffer.from(fileReference).toString('hex');
  
    try {
      const fileData = await this.bee.downloadFile(hexReference); // Fetch file data
      const fileContent = fileData.data ? Buffer.from(fileData.data).toString('utf-8').trim() : '';
      console.log(`Contents of ${filePath}:`);
      console.log(fileContent);
      return fileContent;
    } catch (error) {
      console.error(`Error downloading file ${filePath}:`, error.message);
      throw error;
    }
  }  

  async downloadFiles(mantaray) {
    const forks = mantaray.forks;
    if (!forks) {
      console.error('No forks found in the Mantaray node.');
      return;
    }
  
    for (const fork of Object.values(forks)) {
      const prefix = decodeBytesToPath(fork.prefix || []);
      console.log(`Processing prefix: ${prefix}`);
  
      const fileReference = fork.node.getEntry;
      if (fileReference) {
        console.log(`File reference found: ${Buffer.from(fileReference).toString('hex')}`);
      } else {
        console.log("No file reference found for this prefix.");
      }
  
      if (fork.node.isValueType() && fileReference) {
        const hexReference = Buffer.from(fileReference).toString('hex');
        try {
          const fileData = await this.bee.downloadFile(hexReference); // Returns an object with data
          const fileContent = fileData.data ? Buffer.from(fileData.data).toString('utf-8').trim() : ''; // Safely access content
          console.log(`Contents of ${prefix}:`);
          console.log(fileContent);
        } catch (error) {
          console.error(`Error downloading file ${prefix}:`, error.message);
        }
      } else if (!fork.node.isValueType()) {
        console.log(`Descending into non-value node for prefix: ${prefix}`);
        await this.downloadFiles(fork.node); // Recursive download for directories
      }
    }
  }  
}

module.exports = FileManager;
