const { Bee, Utils } = require('@ethersphere/bee-js');
const { Wallet } = require('ethers');
const { MantarayNode } = require('mantaray-js');
const { getContentType, encodePathToBytes, decodeBytesToPath, hexStringToReference } = require('./utils');
const { readFileSync } = require('fs');
const path = require('path');

class FileManager {
  constructor(beeUrl, privateKey, mantarayNode) {
    if (!beeUrl) {
      throw new Error('Bee URL is required for initializing the FileManager.');
    }
    console.log('Initializing Bee client...');
    this.bee = new Bee(beeUrl);
    this.mantaray = mantarayNode || new MantarayNode();
    this.privateKey = privateKey; // Store privateKey for later use in initializeFeed
    this.topic = Utils.hexToBytes('00'.repeat(32)); // Feed topic with a specific convention
  }
  
  async initializeFeed(stamp) {
    console.log('Initializing wallet and checking for existing feed...');
  
    // Initialize wallet
    this.wallet = new Wallet(this.privateKey);
  
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
      await this.saveFeed(stamp); // Pass stamp explicitly
    }
  }  
  
  async saveFeed(stamp) {
    console.log('Saving Mantaray structure to feed...');
    
    const manifestReference = await this.mantaray.save(async (data) => {
      const uploadResponse = await this.bee.uploadData(stamp, data);
      return hexStringToReference(uploadResponse.reference);
    });
  
    const writer = this.bee.makeFeedWriter('sequence', this.topic, this.wallet.privateKey);
    await writer.upload(stamp, manifestReference);
    
    console.log(`Feed updated with reference: ${Buffer.from(manifestReference).toString('hex')}`);
  }  

  async fetchFeed() {
    console.log('Fetching the latest feed reference...');
    
    if (!this.wallet) {
      throw new Error('Wallet not initialized. Please call initializeFeed first.');
    }
  
    const reader = this.bee.makeFeedReader('sequence', this.topic, this.wallet.address);
    try {
      const { reference } = await reader.download();
      console.log(`Latest feed reference fetched: ${reference}`);
      return reference;
    } catch (error) {
      console.error('Failed to fetch feed:', error.message);
      throw new Error('Could not fetch feed reference.');
    }
  }

  async importFileReferences(items) {
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
  
    const filePath = metadata.fullPath || metadata.Filename || 'file';
    const originalFileName = metadata.originalFileName || path.basename(filePath);
  
    const bytesPath = encodePathToBytes(filePath);
    const formattedReference = hexStringToReference(reference);
  
    const metadataWithOriginalName = {
      ...metadata,
      'Filename': originalFileName, // Use the original filename here
    };
  
    mantaray.addFork(bytesPath, formattedReference, metadataWithOriginalName);
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
  
  searchFilesByName(fileNameQuery, includeMetadata = false) {
    console.log(`Searching for files by name: ${fileNameQuery}`);

    // Use the listFiles function to get all files in the trie
    const allFiles = this.listFiles(this.mantaray, includeMetadata);

    // Filter files whose paths include the query
    const filteredFiles = allFiles.filter((file) =>
        path.posix.basename(file.path).includes(fileNameQuery)
    );

    return filteredFiles;
  }

  searchFiles({ fileName, directory, metadata, minSize, maxSize, extension }, includeMetadata = false) {
    let results = this.listFiles(this.mantaray, true);

    if (fileName) {
        results = results.filter((file) =>
            path.posix.basename(file.path).includes(fileName)
        );
    }

    if (directory) {
        results = results.filter((file) =>
            path.posix.dirname(file.path).includes(directory)
        );
    }

    if (metadata) {
        results = results.filter((file) => {
            for (const [key, value] of Object.entries(metadata)) {
                if (file.metadata?.[key] !== value) {
                    return false;
                }
            }
            return true;
        });
    }

    if (minSize !== undefined && maxSize !== undefined) {
        results = results.filter((file) => {
            const size = parseInt(file.metadata?.['Content-Size'], 10);
            return size >= minSize && size <= maxSize;
        });
    }

    if (extension) {
        results = results.filter((file) =>
            path.posix.extname(file.path) === extension
        );
    }

    return results.map((file) =>
        includeMetadata ? file : { path: file.path }
    );
  }

  listFiles(mantaray, includeMetadata = false) {
    mantaray = mantaray || this.mantaray;
    console.log('Listing files in Mantaray...');
  
    const fileList = [];
    const stack = [{ node: mantaray, path: '' }];
  
    while (stack.length > 0) {
      const { node, path: currentPath } = stack.pop();
      const forks = node.forks;
  
      if (!forks) continue;
  
      // Process forks
      for (const [key, fork] of Object.entries(forks)) {
        // Decode prefix only if necessary
        const decodedPrefix = fork.prefix ? decodeBytesToPath(fork.prefix) : key || 'unknown';
        const fullPath = path.join(currentPath, decodedPrefix); // Use `path.join` for consistency
  
        // If this node represents a file
        if (fork.node.isValueType()) {
          const metadata = fork.node.metadata || {};
          let originalPath = fullPath;
  
          if (metadata['Custom-Metadata']) {
            try {
              const customMetadata = JSON.parse(metadata['Custom-Metadata']); // Ensure metadata is parsed correctly
              originalPath = customMetadata.fullPath || fullPath;
            } catch (e) {
              console.warn(`Invalid metadata JSON for ${fullPath}, using default path.`);
            }
          }
  
          const fileEntry = { path: originalPath };
  
          // Include metadata only if requested
          if (includeMetadata) {
            fileEntry.metadata = metadata;
          }
  
          fileList.push(fileEntry);
        } else {
          // Recurse into subdirectories
          stack.push({ node: fork.node, path: fullPath });
        }
      }
    }
  
    return fileList;
  }  

  getDirectoryStructure(mantaray, rootDirName ) {
    mantaray = mantaray || this.mantaray;
    console.log('Building directory structure from Mantaray...');

    const structure = this.buildDirectoryStructure(mantaray);

    const wrappedStructure = {
        [rootDirName]: structure
    };

    return wrappedStructure;
}

  buildDirectoryStructure(mantaray) {
      mantaray = mantaray || this.mantaray;
      console.log('Building raw directory structure...');

      const structure = {};
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

  getContentsOfDirectory(targetPath, mantaray, rootDirName ) {
      mantaray = mantaray || this.mantaray;

    
      const directoryStructure = this.getDirectoryStructure(mantaray, rootDirName);

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
      const findDirectory = (currentDir, currentPath) => {
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

module.exports = FileManager;
