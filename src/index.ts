import { Bee } from '@ethersphere/bee-js';
import { MantarayNode, Reference } from 'mantaray-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const BEE_URL = 'http://localhost:1633';
const STAMP = 'your-postage-stamp-id';

const bee = new Bee(BEE_URL);

async function main() {
  const rootDir = join(process.cwd(), 'nested-dir'); // Directory to upload
  const mantaray = new MantarayNode();

  console.log("Uploading directory structure...");
  await uploadDirectory(rootDir, mantaray, '');

  console.log("Saving Mantaray manifest...");
  const manifestReference = await saveMantaray(mantaray);
  console.log('Mantaray manifest reference:', Buffer.from(manifestReference).toString('hex'));

  console.log("Listing all files...");
  const files = listFiles(mantaray, '');
  console.log('Files:', files);

  console.log("Downloading files...");
  await downloadFiles(mantaray, '');

  console.log(`Access your files using URL: http://localhost:1633/bzz/${Buffer.from(manifestReference).toString('hex')}/<file-path>`);
}

// Upload a directory recursively
async function uploadDirectory(directoryPath: string, mantaray: MantarayNode, currentPath: string) {
  const filesAndFolders = readdirSync(directoryPath);

  for (const entry of filesAndFolders) {
    const fullPath = join(directoryPath, entry);
    const relativePath = currentPath ? `${currentPath}/${entry}` : entry;

    if (statSync(fullPath).isDirectory()) {
      await uploadDirectory(fullPath, mantaray, relativePath);
    } else {
      const fileData = readFileSync(fullPath); // Read the file as Buffer
      const contentType = getContentType(fullPath); // Determine content type
      console.log("Content Type: ", contentType);
      const uploadResults = await bee.uploadFile(STAMP, fileData, entry, { contentType });

      // Add the file to the Mantaray node with proper metadata
      const metadata = { 'Content-Type': contentType, Filename: entry };
      mantaray.addFork(
        pathToBytes(relativePath),
        hexStringToReference(uploadResults.reference) as Reference
      );

      console.log(`Uploaded file: ${relativePath} with reference: ${uploadResults.reference}`);
      console.log(`Metadata for ${relativePath}:`, metadata);
    }
  }
}

// Save the Mantaray node
async function saveMantaray(mantaray: MantarayNode): Promise<Reference> {
  return await mantaray.save(async (data: Uint8Array) => {
    const uploadResults = await bee.uploadData(STAMP, data);
    return hexStringToReference(uploadResults.reference) as Reference;
  });
}

// List all files in the Mantaray node
function listFiles(mantaray: MantarayNode, currentPath: string): string[] {
  const files: string[] = [];
  const forks = mantaray.forks;

  if (!forks) return files;

  for (const [key, fork] of Object.entries(forks)) {
    const path = `${currentPath}${new TextDecoder().decode(fork.prefix)}`;
    if (fork.node.isValueType()) {
      files.push(path);
    } else {
      files.push(...listFiles(fork.node, `${path}/`));
    }
  }

  return files;
}

// Download all files
async function downloadFiles(mantaray: MantarayNode, currentPath: string) {
  const forks = mantaray.forks;

  if (!forks) return;

  for (const [key, fork] of Object.entries(forks)) {
    const path = `${currentPath}${new TextDecoder().decode(fork.prefix)}`;

    if (fork.node.isValueType()) {
      const fileReference = fork.node.getEntry;
      if (!fileReference) continue;

      const hexReference = Buffer.from(fileReference).toString('hex');
      const fileData = await bee.downloadFile(hexReference);

      const content = decodeFileContent(Buffer.from(fileData.data)); // Decode file content properly
      console.log(`Decoded file content for ${path}: ${content}`);
    } else {
      await downloadFiles(fork.node, `${path}/`);
    }
  }
}

// Helper Functions
function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.txt':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.html':
      return 'text/html';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

function decodeFileContent(fileData: Buffer): string {
  try {
    return fileData.toString('utf-8').trim(); // Ensure clean decoding
  } catch (e) {
    console.warn('Failed to decode file as UTF-8, returning raw content.');
    return fileData.toString();
  }
}

function hexStringToReference(reference: string): Reference {
  const bytes = new Uint8Array(Buffer.from(reference, 'hex'));
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error('Invalid reference length');
  }
  return bytes as Reference;
}

function pathToBytes(string: string): Uint8Array {
  return new TextEncoder().encode(string);
}

main().catch(console.error);
