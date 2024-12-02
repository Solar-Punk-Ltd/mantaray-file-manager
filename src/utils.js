const path = require('path');

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.html': 'text/html',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

function pathToBytes(string) {
  return new TextEncoder().encode(string);
}

function hexStringToReference(reference) {
  const bytes = new Uint8Array(Buffer.from(reference, 'hex'));
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error('Invalid reference length');
  }
  return bytes;
}

function encodePathToBytes(pathString) {
  return new TextEncoder().encode(pathString);
}

function decodeBytesToPath(bytes) {
  return new TextDecoder().decode(bytes);
}

module.exports = { getContentType, pathToBytes, hexStringToReference, encodePathToBytes, decodeBytesToPath };
