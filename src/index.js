const FileManager = require('mantaray-file-manager'); // Import the FileManager class

// Configuration
const BEE_URL = 'http://localhost:1633'; // Bee node URL
const STAMP = '66bddc324176dfa624557a2ce0febcf0c16610dd0b38c6048355128d5292b960'; // Replace with your postage stamp ID

// Main function
async function main() {
  // Initialize FileManager
  const fileManager = new FileManager(BEE_URL);

  // Define the files to upload (simulated in-memory)
  const filesToUpload = [
    { name: 'nested-dir/file1.txt', content: 'Content of file 1' },
    { name: 'nested-dir/file2.json', content: '{"key": "value"}' },
  ];

  console.log("Uploading files...");
  const mantaray = fileManager.createMantarayNode(); // Initialize a MantarayNode

  for (const file of filesToUpload) {
    // Upload each file
    const { reference, metadata } = await fileManager.uploadFile(file, STAMP);

    console.log(`Uploaded file: ${file.name} with reference: ${reference}`);

    // Add file metadata to the Mantaray node
    fileManager.addToMantaray(mantaray, reference, {
      Filename: file.name,
      ...metadata,
    });
  }

  // Inspect the Mantaray node to debug the metadata and structure
  console.log("Inspecting Mantaray node before saving...");
  fileManager.inspectMantarayNode(mantaray);

  console.log("Saving Mantaray manifest...");
  const manifestReference = await fileManager.saveMantaray(mantaray, STAMP);
  console.log(`Mantaray manifest reference: ${Buffer.from(manifestReference).toString('hex')}`);

  console.log("Listing all files...");
  const files = fileManager.listFiles(mantaray);
  console.log('Files:', files);

  console.log("Downloading files...");
  await fileManager.downloadFiles(mantaray);

  console.log(`Access your files using URL: http://localhost:1633/bzz/${Buffer.from(manifestReference).toString('hex')}/<file-path>`);
}

// Run the main function
main().catch(console.error);