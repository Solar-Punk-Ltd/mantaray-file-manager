import path from 'path';

export function getContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Map<string, string> = new Map([
    ['.txt', 'text/plain'],
    ['.json', 'application/json'],
    ['.html', 'text/html'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
  ]);
  return contentTypes.get(ext) || 'application/octet-stream';
}

export function pathToBytes(s: string) {
  return new TextEncoder().encode(s);
}

export function hexStringToReference(reference: string) {
  const bytes = new Uint8Array(Buffer.from(reference, 'hex'));
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error('Invalid reference length');
  }
  return bytes;
}

export function encodePathToBytes(pathString: string) {
  return new TextEncoder().encode(pathString);
}

export function decodeBytesToPath(bytes: Uint8Array) {
  if (bytes.length !== 32) {
    const paddedBytes = new Uint8Array(32);
    paddedBytes.set(bytes.slice(0, 32)); // Truncate or pad the input to ensure it's 32 bytes
    bytes = paddedBytes;
  }
  return new TextDecoder().decode(bytes);
}
