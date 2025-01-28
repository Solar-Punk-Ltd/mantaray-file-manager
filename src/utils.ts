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

export function decodeBytesToPath(bytes: Uint8Array | string | undefined): string {
  if (!bytes) {
    console.warn('Received undefined or empty bytes, returning empty string.');
    return '';
  }

  if (!(bytes instanceof Uint8Array)) {
    console.warn('Invalid byte input detected, converting to Uint8Array.');
    bytes = new TextEncoder().encode(String(bytes)); // Convert to Uint8Array
  }

  if (bytes.length !== 32) {
    const paddedBytes = new Uint8Array(32);
    paddedBytes.set(bytes.subarray(0, 32)); // Use subarray instead of slice
    bytes = paddedBytes;
  }

  return new TextDecoder().decode(bytes);
}
