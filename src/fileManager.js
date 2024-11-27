const { Bee } = require('@ethersphere/bee-js');
const { MantarayNode } = require('mantaray-js');
const { getContentType, pathToBytes, hexStringToReference } = require('./utils');

class FileManager {
  constructor(beeUrl) {
    if (!beeUrl) {
      throw new Error('Bee URL is required for initializing the FileManager.');
    }
    this.bee = new Bee(beeUrl);
  }

  /**
   * Create a new Mantaray node.
   * @returns {MantarayNode} New MantarayNode instance.
   */
  createMantarayNode() {
    return new MantarayNode();
  }

  /**
   * Upload a file with metadata and optional redundancy level.
   */
  async uploadFile(file, stamp, metadata = {}, redundancyLevel = 1) {
    const fileData = await this._readFile(file);
    const fileName = typeof file === 'string' ? require('path').basename(file) : file.name;
    const contentType = getContentType(fileName);

    const headers = {
      'swarm-redundancy-level': redundancyLevel.toString(),
    };

    const uploadResponse = await this.bee.uploadFile(stamp, fileData, fileName, {
      contentType,
      headers,
    });

    const fileMetadata = {
      'Content-Type': contentType,
      'Content-Size': fileData.byteLength.toString(),
      'Time-Uploaded': new Date().toISOString(),
      'Postage-Stamp': stamp,
      ...metadata,
    };

    return {
      reference: uploadResponse.reference,
      metadata: fileMetadata,
    };
  }

  /**
   * Add a file to a Mantaray node.
   */
  addToMantaray(mantaray, reference, metadata) {
    const filePath = metadata.Filename || 'file';
    const bytesPath = pathToBytes(filePath);
  
    console.log(`Adding to Mantaray: Path - ${filePath}, Reference - ${reference}, Metadata -`, metadata);
  
    // Create a new fork node
    const forkNode = new MantarayNode();
    forkNode.setMetadata = metadata; // Attach metadata
    forkNode.setEntry = hexStringToReference(reference); // Link file reference
    forkNode.makeValue(); // Mark as value node
  
    // Add fork to Mantaray
    mantaray.addFork(bytesPath, hexStringToReference(reference), forkNode);
  
    // Debug added fork
    const fork = mantaray.forks[bytesPath[0]];
    if (!fork) {
      console.error(`Failed to add fork for path: ${filePath}`);
    } else {
      console.log(`Fork successfully added for path: ${filePath}`);
      console.log(`Fork Metadata:`, fork.node.getMetadata);
    }
  }

  /**
   * Save a Mantaray node to the Bee network.
   */
  async saveMantaray(mantaray, stamp) {
    const serializedNode = await mantaray.save(async (data) => {
      console.log('Serialized Data Before Upload:', data);
      const uploadResults = await this.bee.uploadData(stamp, data);
      console.log('Upload Results:', uploadResults);
      return hexStringToReference(uploadResults.reference);
    });
  
    console.log('Serialized Mantaray Node:', serializedNode);
    return serializedNode;
  }

  inspectMantarayNode(mantaray) {
    console.log('Inspecting Mantaray Node:');
    const forks = mantaray.forks;
  
    if (!forks) {
      console.error('No forks found in the Mantaray node.');
      return;
    }
  
    for (const [key, fork] of Object.entries(forks)) {
      const filePath = new TextDecoder().decode(fork.prefix);
      console.log(`Fork Key: ${key}, Path: ${filePath}`);
      console.log(`Fork Metadata:`, fork.metadata);
    }
  }

  /**
   * List all files in a Mantaray node.
   */
  listFiles(mantaray) {
    console.log('Mantaray forks:', mantaray.forks);
  
    const files = [];
    const forks = mantaray.forks;
  
    if (!forks) {
      console.error('No forks found in the Mantaray node.');
      return files;
    }
  
    for (const [key, fork] of Object.entries(forks)) {
      const filePath = new TextDecoder().decode(fork.prefix);
      let metadata = fork.metadata; // Retrieve metadata
  
      if (metadata) {
        try {
          metadata = JSON.parse(metadata); // Parse serialized metadata
        } catch (e) {
          console.error('Failed to parse metadata:', metadata);
          metadata = {};
        }
      } else {
        console.error(`Metadata is missing for path: ${filePath}`);
      }
  
      console.log(`Found fork: Key - ${key}, Path - ${filePath}, Metadata -`, metadata);
  
      if (fork.node.isValueType()) {
        files.push({ path: filePath, metadata });
      }
    }
  
    console.log('Final list of files:', files);
    return files;
  }

  /**
   * Download files from the Bee network using a Mantaray node.
   */
  async downloadFiles(mantaray) {
    const forks = mantaray.forks;
  
    if (!forks) {
      console.error('No forks found to download.');
      return;
    }
  
    for (const [key, fork] of Object.entries(forks)) {
      const filePath = new TextDecoder().decode(fork.prefix);
      let metadata = fork.metadata;
  
      if (metadata) {
        try {
          metadata = JSON.parse(metadata); // Parse serialized metadata
        } catch (e) {
          console.error('Failed to parse metadata:', metadata);
          metadata = {};
        }
      } else {
        console.error(`Metadata is missing for path: ${filePath}`);
      }
  
      console.log(`Downloading file: Path - ${filePath}, Metadata -`, metadata);
  
      if (fork.node.isValueType()) {
        const fileReference = fork.node.getEntry;
        if (!fileReference) continue;
  
        const hexReference = Buffer.from(fileReference).toString('hex');
        const fileData = await this.bee.downloadFile(hexReference);
  
        console.log(`File content: ${fileData.data.toString('utf-8')}`);
      }
    }
  }  

  /**
   * Helper function to read files in Node.js or browser environments.
   */
  async _readFile(file) {
    if (typeof window !== 'undefined' && file instanceof File) {
      // For browser environment, use File API
      return await file.arrayBuffer();
    } else if (typeof file === 'string') {
      // For Node.js environment, read the file from the file system
      const fs = require('fs');
      return fs.readFileSync(file);
    } else if (file && file.name && file.content) {
      // Handle in-memory file objects with `name` and `content`
      if (Buffer.isBuffer(file.content)) {
        return file.content;
      }
      return Buffer.from(file.content);
    } else {
      throw new Error('Invalid file type for upload.');
    }
  }  
}

module.exports = FileManager;
