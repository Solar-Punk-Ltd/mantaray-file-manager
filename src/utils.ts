import { Bytes } from '@solarpunkltd/mantaray-js';
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

export function decodeBytesToPath(bytes: Bytes<32>) {
  return new TextDecoder().decode(bytes);
}

export function decodeEncodedPath(encodedPath: string) {
  const segments = encodedPath.split('/');

  const decodedSegments = segments.map((segment) => {
    if (segment === null) return '';
    const match = segment.match(/.{1,2}/g);
    if (!match) return '';
    const hexBytes = match.map((hex) => parseInt(hex, 16));
    const decodedBytes = new Uint8Array(hexBytes);
    return new TextDecoder().decode(decodedBytes);
  });

  const decodedPath = decodedSegments.join('/');

  return decodedPath;
}
