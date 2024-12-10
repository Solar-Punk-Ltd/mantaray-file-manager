const FileManager = require('mantaray-file-manager'); // Do not change the path
const { Bee } = require('@ethersphere/bee-js'); // Import Bee.js directly
const path = require('path');
const fs = require('fs');

const BEE_URL = 'http://localhost:1633'; // Ensure this matches your Bee node's URL
const STAMP = '4d81899d61f7fc6ae16f809fe410513057c7433fd05faee09f83c5d8db408a65'; // Replace with a valid postage stamp

async function main() {
  try {
    console.log('### Simulation: FileManager Operations ###');

    // Initialize Bee.js and FileManager
    const bee = new Bee(BEE_URL);

    // Verify the postage stamp
    try {
      const batch = await bee.getPostageBatch(STAMP);
      console.log(`[INFO] Postage batch details: ${JSON.stringify(batch)}`);
    } catch (error) {
      throw new Error(`Invalid postage stamp: ${error.message}`);
    }

    // Directory for testing file uploads
    const dirPath = path.join(__dirname, 'nested-dir');
    if (!fs.existsSync(dirPath)) {
      throw new Error('Directory "nested-dir" does not exist.');
    }

    // Get all files in the directory, including subdirectories
    const filesToUpload = [];
    function getAllFiles(dirPath, arrayOfFiles) {
      const files = fs.readdirSync(dirPath);

      arrayOfFiles = arrayOfFiles || [];

      files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
          arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
          arrayOfFiles.push(filePath);
        }
      });

      return arrayOfFiles;
    }
    getAllFiles(dirPath, filesToUpload);

    if (filesToUpload.length < 6) {
      throw new Error('Expected at least 6 files for the test.');
    }

    // Select three files for direct Bee.js upload and three for FileManager
    const externalFiles = filesToUpload.slice(0, 3);
    const internalFiles = filesToUpload.slice(3, 6);

    console.log('\n==== Uploading External Files with Bee.js ====');
    for (const filePath of externalFiles) {
      const fileName = path.basename(filePath);
      const fileData = fs.readFileSync(filePath);

      try {
        const reference = await bee.uploadFile(STAMP, fileData, fileName, {
          contentType: 'text/plain',
          pin: true, // Ensure the file is pinned
        });
        console.log(`[INFO] Uploaded and pinned with Bee.js: ${filePath}, Reference: ${reference.reference}`);
      } catch (error) {
        console.error(`[ERROR] Bee.js upload failed for ${filePath}: ${error.message}`);
      }
    }

    // Re-import pinned files into FileManager's MantarayNode
    const fileManager = new FileManager(BEE_URL);
    console.log('[INFO] FileManager initialized.');
    console.log('\n==== Re-Importing Pinned Files ====');
    await fileManager.initialize();
    console.log('[INFO] Pinned files re-imported.');

    console.log('\n==== Uploading Internal Files with FileManager ====');
    for (const filePath of internalFiles) {
      try {
        const customMetadata = {
          description: `Metadata for ${path.basename(filePath)}`,
          tags: ['internal', 'simulation', 'demo'],
        };

        const reference = await fileManager.uploadFile(filePath, undefined, STAMP, customMetadata);
        console.log(`[INFO] Uploaded with FileManager: ${filePath}, Reference: ${reference}`);
      } catch (error) {
        console.error(`[ERROR] FileManager upload failed for ${filePath}: ${error.message}`);
      }
    }

    console.log('\n==== Saving Manifest ====');
    const manifestReference = await fileManager.saveMantaray(undefined, STAMP);
    console.log(`[INFO] Manifest saved successfully. Reference: ${manifestReference}`);

    console.log('\n==== Listing Files in Mantaray ====');
    const filesWithMetadata = fileManager.listFiles(undefined, '', true);
    console.log('[INFO] Final List of Files with Metadata:', JSON.stringify(filesWithMetadata, null, 2));

    console.log('\n### Simulation Completed Successfully ###');
  } catch (error) {
    console.error(`[ERROR] Simulation failed: ${error.message}`);
  }
}

main();