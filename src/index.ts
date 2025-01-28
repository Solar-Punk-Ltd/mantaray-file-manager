import { Bee } from '@ethersphere/bee-js'; // Import Bee.js directly
import fs from 'fs';
import path from 'path';

import { FileManager } from './fileManager';

const BEE_URL = 'http://localhost:1633'; // Ensure this matches your Bee node's URL
const STAMP = 'ff7e87ac1a41665d93c0c7d449def0e9882ab0e490f182885db9247b203d5870'; // Replace with a valid postage stamp

const wallet = {
  address: '0xd2Bd095636838B3272e107fEC642087C30C4CE08',
  privateKey: 'af829bfc5c90818776f0b3d587c14c8e7a4222b781e9f7ebc6e527f4dfd117c2',
};

async function main(): Promise<void> {
  try {
    console.log('### Simulation: FileManager Operations ###');

    // Initialize Bee.js and FileManager
    const bee = new Bee(BEE_URL);

    // Verify the postage stamp
    try {
      const batch = await bee.getPostageBatch(STAMP);
      console.log(`[INFO] Postage batch details: ${JSON.stringify(batch)}`);
    } catch (error: any) {
      throw new Error(`Invalid postage stamp: ${error.message}`);
    }

    // Directory for testing file uploads
    const dirPath = path.join(__dirname, 'nested-dir');
    if (!fs.existsSync(dirPath)) {
      throw new Error('Directory "nested-dir" does not exist.');
    }

    // Get all files in the directory, including subdirectories
    const filesToUpload = getAllFiles(dirPath);

    if (filesToUpload.length === 0) {
      throw new Error('No files found in the "nested-dir" directory.');
    }

    console.log('\n==== Uploading All Files in Nested Directory with FileManager ====');
    const fileManager = new FileManager(BEE_URL, wallet.privateKey); // Initialize FileManager

    for (const fileInfo of filesToUpload) {
      try {
        const customMetadata = {
          description: `Metadata for ${fileInfo.relativePath}`,
          tags: ['nested-dir', 'simulation', 'demo'],
          fullPath: fileInfo.relativePath,
          originalFileName: fileInfo.fileName, // Add this line
        };

        const reference = await fileManager.uploadFile(fileInfo.fullPath, undefined, STAMP, customMetadata);
        console.log(`[INFO] Uploaded: ${fileInfo.relativePath}, Reference: ${reference}`);
      } catch (error: any) {
        console.error(`[ERROR] FileManager upload failed for ${fileInfo.fullPath}: ${error.message}`);
      }
    }

    console.log('\n==== Saving Manifest ====');
    const manifestReference = await fileManager.saveMantaray(undefined, STAMP);
    console.log(`[INFO] Manifest saved successfully. Reference: ${manifestReference}`);

    console.log('\n==== Listing Files in Mantaray ====');
    const filesWithMetadata = fileManager.listFiles(undefined);
    console.log('[INFO] Final List of Files with Metadata:', JSON.stringify(filesWithMetadata, null, 2));

    console.log('\n==== Getting Directory Structure ====');
    const directoryStructure = fileManager.getDirectoryStructure(undefined, 'nested-dir');
    console.log('[INFO] Directory Structure:', JSON.stringify(directoryStructure, null, 2));

    console.log('\n==== Getting Contents of Specific Directory ====');
    const targetPath = 'subdir1'; // Replace with your target path
    const directoryContents = fileManager.getContentsOfDirectory(targetPath, undefined, 'nested-dir');
    console.log(`[INFO] Contents of '${targetPath}':`, JSON.stringify(directoryContents, null, 2));

    console.log('\n### Simulation Completed Successfully ###');
  } catch (error: any) {
    console.error(`[ERROR] Simulation failed: ${error.message}`);
  }
}

interface FileInfo {
  fullPath: string;
  relativePath: string;
  fileName: string;
}

function getAllFiles(dirPath: string, arrayOfFiles: FileInfo[] = [], basePath = dirPath): FileInfo[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    const relativePath = path.relative(basePath, fullPath);

    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles, basePath);
    } else {
      arrayOfFiles.push({
        fullPath: fullPath,
        relativePath: relativePath,
        fileName: file,
      });
    }
  });

  return arrayOfFiles;
}

main();
