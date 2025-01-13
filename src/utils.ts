import path from 'path';

import { SharedMessage } from './types';

export function getContentType(filePath: string): string {
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

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isStrictlyObject(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

export function assertSharedMessage(value: unknown): asserts value is SharedMessage {
  if (!isStrictlyObject(value)) {
    throw new TypeError('SharedMessage has to be object!');
  }

  const message = value as unknown as SharedMessage;

  if (typeof message.owner !== 'string') {
    throw new TypeError('owner property of SharedMessage has to be string!');
  }

  if (!Array.isArray(message.references)) {
    throw new TypeError('references property of SharedMessage has to be array!');
  }

  if (message.timestamp !== undefined && typeof message.timestamp !== 'number') {
    throw new TypeError('timestamp property of SharedMessage has to be number!');
  }

  if (message.message !== undefined && typeof message.message !== 'string') {
    throw new TypeError('message property of SharedMessage has to be string!');
  }
}

export function decodeBytesToPath(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    const paddedBytes = new Uint8Array(32);
    paddedBytes.set(bytes.slice(0, 32)); // Truncate or pad the input to ensure it's 32 bytes
    bytes = paddedBytes;
  }
  return new TextDecoder().decode(bytes);
}

export function encodePathToBytes(pathString: string): Uint8Array {
  return new TextEncoder().encode(pathString);
}
