import { BeeRequestOptions, Utils } from '@ethersphere/bee-js';
import { Binary } from 'cafe-utility';
import path from 'path';

import { Index, ShareItem } from './types';

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

export function assertSharedMessage(value: unknown): asserts value is ShareItem {
  if (!isStrictlyObject(value)) {
    throw new TypeError('SharedMessage has to be object!');
  }

  const message = value as unknown as ShareItem;

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

export function makeBeeRequestOptions(historyRef?: string, publisher?: string, timestamp?: number): BeeRequestOptions {
  const options: BeeRequestOptions = {};
  if (historyRef !== undefined) {
    options.headers = { 'swarm-act-history-address': historyRef };
  }
  if (publisher !== undefined) {
    options.headers = {
      ...options.headers,
      'swarm-act-publisher': publisher,
    };
  }
  if (timestamp !== undefined) {
    options.headers = { ...options.headers, 'swarm-act-timestamp': timestamp.toString() };
  }

  return options;
}

export function numberToFeedIndex(index: number | undefined): string | undefined {
  if (index === undefined) {
    return undefined;
  }
  const bytes = new Uint8Array(8);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(4, index);

  return Utils.bytesToHex(bytes);
}

export function makeNumericIndex(index: Index): number {
  if (index instanceof Uint8Array) {
    return Binary.uint64BEToNumber(index);
  }

  if (typeof index === 'string') {
    const base = 16;
    const ix = parseInt(index, base);
    if (isNaN(ix)) {
      throw new TypeError(`Invalid index: ${index}`);
    }
    return ix;
  }

  if (typeof index === 'number') {
    return index;
  }

  throw new TypeError(`Unknown type of index: ${index}`);
}
