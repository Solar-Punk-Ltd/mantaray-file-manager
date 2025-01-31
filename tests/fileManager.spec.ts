import { Bee, Reference, Utils } from '@ethersphere/bee-js';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MantarayNode } from '@solarpunkltd/mantaray-js';
import { hexlify } from 'ethers';

import { FileManager } from '../src/fileManager';
import { encodePathToBytes } from '../src/utils';

import { createMockBee, createMockMantarayNode } from './mockHelpers';
import { BEE_URL } from './utils';

jest.mock('@solarpunkltd/mantaray-js', () => {
  const mockMantarayNode = jest.fn(() => createMockMantarayNode());
  return {
    MantarayNode: mockMantarayNode,
  };
});

jest.mock('fs', () => {
  const mockBuffer = jest.fn(() => Buffer.from('Mock file content'));
  return {
    readFileSync: mockBuffer,
  };
});

describe('FileManager - Setup', () => {
  it('should initialize with a valid Bee URL', () => {
    const bee = new Bee(BEE_URL);
    const validPrivateKey = '0x'.padEnd(66, 'a'); // 64-character hex string padded with 'a'
    const fileManager = new FileManager(bee, validPrivateKey);
  });
});

describe('FileManager - Initialize', () => {
  let fileManager: FileManager;
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.importedFileInfoList = [];
    jest.clearAllMocks();
  });

  it('should call importPinnedReferences during initialization', async () => {
    const importPinnedReferencesSpy = jest.spyOn(fileManager, 'importPinnedReferences').mockResolvedValue();

    await fileManager.initialize(undefined);

    expect(importPinnedReferencesSpy).toHaveBeenCalledTimes(1);
  });

  it('should add all pinned references to Mantaray during initialization', async () => {
    const mockPins: Reference[] = [
      '79ed514ec2da96ef7b7a64f55e1e4470cc163c7d4dbd5cbdf8a9fd4ab3993d94' as Reference,
      '8d12623989dd6f6f899209c5029c7cba8b36c408b4106a21b407523c27af1f34' as Reference,
      'df5c87236b99ef474de7936d74d0e6df0b6cd3c66ad27ac45e6eb081459e3708' as Reference,
    ];

    (jest.spyOn(mockBee, 'getAllPins') as jest.MockedFunction<() => Promise<Reference[]>>).mockResolvedValue(mockPins);

    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee
    fileManager.mantaray = createMockMantarayNode() as any; // Inject mockMantarayNode

    jest.spyOn(fileManager.mantaray, 'addFork');

    // Run the initialize method
    await fileManager.initialize(undefined);

    // Assert the number of calls
    expect(fileManager.mantaray.addFork).toHaveBeenCalledTimes(mockPins.length);

    // Assert the specific calls
    mockPins.forEach((pin) => {
      expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
        expect.any(Uint8Array), // Path (encoded from filename)
        expect.any(String), // Reference (encoded pin)
        expect.objectContaining({
          Filename: `pinned-${pin.substring(0, 6)}`,
          pinned: 'true',
        }),
      );
    });
  });

  it('should log an error if importPinnedReferences fails', async () => {
    jest.spyOn(fileManager, 'importPinnedReferences').mockRejectedValue(new Error('Mock error during import'));
    console.error = jest.fn(); // Mock console.error

    await expect(fileManager.initialize(undefined)).rejects.toThrow('Mock error during import');
    expect(console.error).toHaveBeenCalledWith('[ERROR] Failed to import references: Mock error during import');
  });
});

describe('FileManager - Mantaray manipulation', () => {
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  it('should add a file to the Mantaray node', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);

    // Mock addFork method on the mantaray instance
    fileManager.mantaray.addFork = jest.fn();

    // Call the method
    fileManager.addToMantaray(fileManager.mantaray, 'a'.repeat(64), { Filename: '1.txt' });

    // Verify that addFork was called with the correct arguments
    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('1.txt'), // Encoded path for '1.txt'
      'a'.repeat(64), // Hex bytes of the reference
      expect.objectContaining({ Filename: '1.txt' }), // Metadata containing the filename
    );
  });

  it('should ensure metadata is preserved during addToMantaray', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    const customMetadata = { Author: 'Test Author' };
    fileManager.addToMantaray(mantaray, 'a'.repeat(64), customMetadata);

    expect(mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file'), // Use encodePathToBytes to convert 'file' into bytes
      expect.any(String),
      expect.objectContaining({
        Author: 'Test Author',
        Filename: 'file',
      }),
    );
  });

  it('should add a file to the Mantaray node with default filename', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);

    // Spy on the addFork method of mantaray
    const addForkSpy = jest.spyOn(fileManager.mantaray, 'addFork');

    fileManager.addToMantaray(fileManager.mantaray, 'a'.repeat(64), {});

    expect(addForkSpy).toHaveBeenCalledWith(
      encodePathToBytes('file'), // Use encodePathToBytes instead of Utils.hexToBytes
      expect.any(String),
      expect.objectContaining({ Filename: 'file' }),
    );

    // Restore the original method after the test
    addForkSpy.mockRestore();
  });
});

describe('FileManager - Save Mantaray', () => {
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should save a Mantaray node and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const result = await fileManager.saveMantaray(fileManager.mantaray, 'test-stamp');
    expect(result).toBe('a'.repeat(64));
    expect(mockBee.uploadFile).toHaveBeenCalledWith('test-stamp', expect.any(Uint8Array), 'manifest', {
      contentType: 'application/json',
    });
  });

  it('should handle errors during saveMantaray', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    // Assert that uploadFile is defined
    if (mockBee.uploadFile) {
      (jest.spyOn(mockBee, 'uploadFile') as jest.Mock).mockRejectedValueOnce(
        new Error('Upload failed') as unknown as never,
      );
    } else {
      throw new Error('mockBee.uploadFile is undefined');
    }

    await expect(fileManager.saveMantaray(fileManager.mantaray, 'test-stamp')).rejects.toThrow('Upload failed');
  });
});

describe('FileManager - Upload File', () => {
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should upload a file and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);

    // Spy on the uploadFile method of Bee
    const uploadFileSpy = jest.spyOn(fileManager.bee, 'uploadFile').mockResolvedValue({
      reference: 'a'.repeat(64) as Reference,
      cid: () => 'mocked-cid', // Mock function returning a CID string
      historyAddress: 'mocked-history-address',
    });

    type BatchId = string & { readonly length: 64 };
    const batchId: BatchId = 'a'.repeat(64) as BatchId;

    jest.spyOn(fileManager, 'fetchStamp').mockResolvedValue({
      exists: true,
      usable: true,
      batchID: batchId,
      utilization: 0,
      depth: 17,
      amount: '1000',
      batchTTL: 1000000,
      label: 'test-batch-label',
      bucketDepth: 16,
      blockNumber: 123456,
      immutableFlag: false,
    });

    const mockFilePath = 'nested-dir/file1.txt';
    const result = await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp', {}, '1');

    expect(result).toBe('a'.repeat(64));
    expect(uploadFileSpy).toHaveBeenCalledWith('test-stamp', expect.any(Buffer), 'file1.txt', {
      contentType: 'text/plain',
      headers: { 'swarm-redundancy-level': '1' },
    });

    uploadFileSpy.mockRestore();
  });

  it('should handle invalid file uploads gracefully', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    jest
      .spyOn(mockBee, 'uploadFile')
      .mockRejectedValueOnce(new Error('BatchId not valid hex string of length 64: test-stamp'));

    await expect(fileManager.uploadFile('invalid-path', mantaray, 'test-stamp')).rejects.toThrow(
      'BatchId not valid hex string of length 64: test-stamp',
    );
  });

  it('should add metadata to Mantaray for uploaded files', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    // Spy on the addFork method of mantaray
    const addForkSpy = jest.spyOn(fileManager.mantaray, 'addFork');

    const mockFilePath = 'nested-dir/file1.txt';
    const customMetadata = { description: 'Test description', tags: ['test'] };

    await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp', customMetadata, '2');

    expect(addForkSpy).toHaveBeenCalledWith(
      encodePathToBytes('file1.txt'),
      expect.any(String),
      expect.objectContaining({
        Filename: 'file1.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify(customMetadata),
      }),
    );

    // Restore the original method after the test
    addForkSpy.mockRestore();
  });

  it('should use default metadata when custom metadata is not provided', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    // Spy on the addFork method of mantaray
    const addForkSpy = jest.spyOn(fileManager.mantaray, 'addFork');

    const mockFilePath = 'nested-dir/file2.txt';

    await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp');

    expect(addForkSpy).toHaveBeenCalledWith(
      encodePathToBytes('file2.txt'),
      expect.any(String),
      expect.objectContaining({
        Filename: 'file2.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify({}),
      }),
    );

    // Restore the original method after the test
    addForkSpy.mockRestore();
  });
});

describe('FileManager - List Files', () => {
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  it('should list files correctly in Mantaray', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);

    // Use the mock MantarayNode with correctly structured forks
    fileManager.mantaray = createMockMantarayNode();

    const files = fileManager.listFiles(fileManager.mantaray, false); // Explicitly exclude metadata

    expect(files.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });

  it('should handle missing forks gracefully in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = { forks: null } as any;

    const files = fileManager.listFiles(mantaray);
    expect(files).toEqual([]);
  });

  it('should handle nested paths correctly in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);

    // Custom nested structure with only the 'nested' fork
    const customForks = {
      nested: {
        prefix: new TextEncoder().encode('nested'), // Correctly encode 'nested' as bytes
        node: {
          forks: {
            'file.txt': {
              prefix: new TextEncoder().encode('file.txt'), // Correctly encode 'file.txt' as bytes
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('c'.repeat(64), 'hex')),
                metadata: { Filename: 'file.txt', 'Content-Type': 'text/plain' },
              },
            },
          },
          isValueType: () => false,
        },
      },
    } as any;

    // Create Mantaray node with only custom forks (exclude default forks)
    const mantaray = createMockMantarayNode(customForks, true);
    const files = fileManager.listFiles(mantaray, false); // Exclude metadata

    expect(files.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([{ path: 'nested/file.txt' }]);
  });

  it('should ensure metadata is not duplicated in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    const files = fileManager.listFiles(mantaray, true); // Explicitly include metadata

    expect(
      files.map((f: any) => ({
        path: f.path.split('\x00').join('').trim(),
        metadata: typeof f.metadata === 'function' ? f.metadata() : f.metadata,
      })),
    ).toEqual([
      {
        path: 'file/1.txt',
        metadata: {
          Filename: '1.txt',
          'Content-Type': 'text/plain',
        },
      },
      {
        path: 'file/2.txt',
        metadata: {
          Filename: '2.txt',
          'Content-Type': 'text/plain',
        },
      },
    ]);
  });

  it('should list files correctly even when prefix is undefined', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    mantaray.forks.file.prefix = undefined; // Simulate undefined prefix
    const files = fileManager.listFiles(mantaray, false); // Exclude metadata

    expect(files.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });

  it('should list files with metadata in custom forks', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const customForks = {
      custom: {
        prefix: encodePathToBytes('custom'),
        node: {
          forks: {
            'file3.txt': {
              prefix: encodePathToBytes('file3.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('c'.repeat(64), 'hex')),
                getMetadata: {
                  Filename: 'file3.txt',
                  'Content-Type': 'application/json',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    } as any;

    const mantaray = createMockMantarayNode(customForks, true) as any;
    const files = fileManager.listFiles(mantaray, true); // Explicitly include metadata

    expect(
      files.map((file: any) => ({
        path: file.path.split('\x00').join(''), // Remove trailing whitespaces from the path
        metadata: file.metadata,
      })),
    ).toEqual([
      {
        path: 'custom/file3.txt',
        metadata: {
          Filename: 'file3.txt',
          'Content-Type': 'application/json',
        },
      },
    ]);
  });
});

describe('FileManager - Search Files by Name', () => {
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));
  let fileManager: FileManager;

  beforeEach(() => {
    fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.mantaray = createMockMantarayNode(); // Use default mock Mantaray
  });

  it('should return files matching the query', () => {
    const result = fileManager.searchFilesByName('1.txt');
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([{ path: 'file/1.txt' }]);
  });

  it('should return multiple files when multiple match the query', () => {
    const result = fileManager.searchFilesByName('file');
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });

  it('should return an empty array when no files match the query', () => {
    const result = fileManager.searchFilesByName('nonexistent');
    expect(result).toEqual([]);
  });

  it('should return files with metadata when includeMetadata is true', () => {
    const result = fileManager.searchFilesByName('1.txt', true);
    expect(
      result.map((f) => ({
        path: f.path.split('\x00').join(''),
        metadata: f.metadata,
      })),
    ).toEqual([
      {
        path: 'file/1.txt',
        metadata: {
          Filename: '1.txt',
          'Content-Type': 'text/plain',
        },
      },
    ]);
  });
});

describe('FileManager - Advanced Search Files', () => {
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));
  let fileManager: FileManager;

  beforeEach(() => {
    fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.mantaray = createMockMantarayNode() as any; // Inject mock Mantaray node
  });

  it('should return files matching the file name', () => {
    const result = fileManager.searchFiles({ fileName: '1.txt' });
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([{ path: 'file/1.txt' }]);
  });

  it('should return files within a specific directory', () => {
    const result = fileManager.searchFiles({ directory: 'file' });
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });

  it('should return files matching metadata', () => {
    const result = fileManager.searchFiles({
      metadata: { 'Content-Type': 'text/plain' },
    });
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });

  it('should return files within a specific size range', () => {
    const customForks = {
      file: {
        prefix: encodePathToBytes('file'),
        node: {
          forks: {
            '1.txt': {
              prefix: encodePathToBytes('1.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('a'.repeat(64), 'hex')),
                getMetadata: {
                  Filename: '1.txt',
                  'Content-Type': 'text/plain',
                  'Content-Size': '500', // Size in bytes
                },
              },
            },
            '2.txt': {
              prefix: encodePathToBytes('2.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('b'.repeat(64), 'hex')),
                getMetadata: {
                  Filename: '2.txt',
                  'Content-Type': 'text/plain',
                  'Content-Size': '1500', // Size in bytes
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    } as any;

    fileManager.mantaray = createMockMantarayNode(customForks, true) as any;

    const result = fileManager.searchFiles({ minSize: 1000, maxSize: 2000 });
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([{ path: 'file/2.txt' }]);
  });

  it('should return files with a specific extension', () => {
    // Custom forks for this specific test
    const customForks = {
      file: {
        prefix: encodePathToBytes('file'),
        node: {
          forks: {
            '1.txt': {
              prefix: encodePathToBytes('1.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('a'.repeat(64), 'hex')),
                getMetadata: {
                  Filename: '1.txt',
                  'Content-Type': 'text/plain',
                },
              },
            },
            '2.txt': {
              prefix: encodePathToBytes('2.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('b'.repeat(64), 'hex')),
                getMetadata: {
                  Filename: '2.txt',
                  'Content-Type': 'text/plain',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    };

    // Create mock MantarayNode with only custom forks
    const mantaray = createMockMantarayNode(customForks, true); // Exclude default forks
    fileManager.mantaray = mantaray;

    const result = fileManager.searchFiles({ extension: '.txt' });
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });

  it('should return files matching multiple criteria', () => {
    // Custom forks for this specific test
    const customForks = {
      file: {
        prefix: encodePathToBytes('file'),
        node: {
          forks: {
            '2.txt': {
              prefix: encodePathToBytes('2.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('b'.repeat(64), 'hex')),
                getMetadata: {
                  Filename: '2.txt',
                  'Content-Type': 'text/plain',
                  'Content-Size': '1500',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    };

    // Create mock MantarayNode with only custom forks
    const mantaray = createMockMantarayNode(customForks, true); // Exclude default forks
    fileManager.mantaray = mantaray;

    const result = fileManager.searchFiles({
      fileName: '2.txt',
      directory: 'file',
      metadata: { 'Content-Type': 'text/plain' },
      minSize: 0,
      maxSize: 2000,
      extension: '.txt',
    });
    expect(result.map((f) => ({ path: f.path.split('\x00').join('') }))).toEqual([{ path: 'file/2.txt' }]);
  });

  it('should return an empty array if no files match the criteria', () => {
    const result = fileManager.searchFiles({
      fileName: 'nonexistent.txt',
    });
    expect(result).toEqual([]);
  });
});

describe('FileManager - Download File', () => {
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should download a specific file by path', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = createMockBee() as unknown as Bee; // Inject mockBee
    fileManager.mantaray = createMockMantarayNode(); // Use updated mock MantarayNode

    const content = await fileManager.downloadFile(fileManager.mantaray, 'file/1.txt');
    expect(content.data).toBe('Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(fileManager.bee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('should handle missing files gracefully', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    await expect(fileManager.downloadFile(mantaray, 'file/3.txt')).rejects.toThrow('Path segment not found: 3.txt');
  });

  it('should throw an error if a path segment is not found', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    jest.spyOn(fileManager, 'listFiles').mockReturnValue([{ path: 'file/unknown.txt', metadata: {} }]);

    await expect(fileManager.downloadFile(mantaray, 'file/unknown.txt')).rejects.toThrow(
      'Path segment not found: unknown.txt',
    );
  });

  it('should handle the case where a path does not point to a file in downloadFile', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    jest.spyOn(fileManager, 'listFiles').mockReturnValue([
      { path: 'file/1.txt', metadata: {} },
      { path: 'file/2.txt', metadata: {} },
    ]);
    jest.spyOn(mantaray.forks.file.node.forks['1.txt'].node, 'isValueType').mockReturnValue(false);

    await expect(fileManager.downloadFile(mantaray, 'file/1.txt')).rejects.toThrow(
      'Path does not point to a file: file/1.txt',
    );
  });

  it('should return metadata with file data during download', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const mockForks = {
      file: {
        prefix: encodePathToBytes('file'),
        node: {
          forks: {
            '1.txt': {
              prefix: encodePathToBytes('1.txt'),
              node: {
                isValueType: () => true,
                getEntry: 'a'.repeat(64),
                getMetadata: {
                  Filename: '1.txt',
                  'Content-Type': 'text/plain',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    } as any;

    const mantaray = createMockMantarayNode(mockForks) as any;
    const result = await fileManager.downloadFile(mantaray, 'file/1.txt');

    expect(result).toEqual({
      data: 'Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      metadata: {
        Filename: '1.txt',
        'Content-Type': 'text/plain',
      },
    });
  });
});

describe('FileManager - Download Metadata', () => {
  let fileManager: FileManager;
  let mantaray: MantarayNode;

  beforeEach(() => {
    const mockBee = createMockBee();
    const mockPrivateKey = '0x' + '1'.repeat(64); // Valid mock private key
    fileManager = new FileManager('http://localhost:1633', mockPrivateKey);
    fileManager.bee = mockBee as any; // Inject mock Bee
    mantaray = createMockMantarayNode({
      file: {
        prefix: Buffer.from('file'),
        node: {
          forks: {
            'file1.txt': {
              prefix: Buffer.from('file1.txt'),
              node: {
                isValueType: () => true,
                getEntry: Buffer.from('a'.repeat(64), 'hex'),
                getMetadata: {
                  Filename: 'file1.txt',
                  'Content-Type': 'text/plain',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    }) as any;
  });

  it('should return metadata for a valid file path', async () => {
    const result = await fileManager.downloadFile(mantaray, 'file/file1.txt', true);

    expect(result).toEqual({
      metadata: {
        Filename: 'file1.txt',
        'Content-Type': 'text/plain',
      },
    });
  });

  it('should handle missing metadata gracefully', async () => {
    const mantarayWithNoMetadata = createMockMantarayNode({
      file: {
        prefix: Buffer.from('file'),
        node: {
          forks: {
            'file2.txt': {
              prefix: Buffer.from('file2.txt'),
              node: {
                isValueType: () => true,
                getEntry: Buffer.from('b'.repeat(64), 'hex'),
                getMetadata: {}, // No metadata
              },
            },
          },
          isValueType: () => false,
        },
      },
    }) as any;

    const result = await fileManager.downloadFile(mantarayWithNoMetadata, 'file/file2.txt', true);

    expect(result).toEqual({
      metadata: {}, // Empty metadata
    });
  });

  it('should throw an error for an invalid file path', async () => {
    await expect(fileManager.downloadFile(mantaray, 'file/nonexistent.txt', true)).rejects.toThrow(
      'Path segment not found: nonexistent.txt',
    );
  });

  it('should not download the file content when onlyMetadata is true', async () => {
    const spyDownloadFile = jest.spyOn(fileManager.bee, 'downloadFile');

    const result = await fileManager.downloadFile(mantaray, 'file/file1.txt', true);

    expect(spyDownloadFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      metadata: {
        Filename: 'file1.txt',
        'Content-Type': 'text/plain',
      },
    });
  });
});

describe('FileManager - Download Files', () => {
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should download all files from Mantaray', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const mockForks = {
      file: {
        prefix: encodePathToBytes('file'), // Use encodePathToBytes instead of Utils.hexToBytes
        node: {
          forks: {
            '1.txt': {
              prefix: encodePathToBytes('1.txt'), // Use encodePathToBytes
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('a'.repeat(64), 'hex')),
              },
            },
            '2.txt': {
              prefix: encodePathToBytes('2.txt'), // Use encodePathToBytes
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('b'.repeat(64), 'hex')),
              },
            },
          },
          isValueType: () => false,
        },
      },
    } as any;

    const mantaray = createMockMantarayNode(mockForks) as any;
    await fileManager.downloadFiles(mantaray);

    expect(mockBee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
    expect(mockBee.downloadFile).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('should correctly handle download errors in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const mantaray = createMockMantarayNode() as any;
    jest.spyOn(mockBee, 'downloadFile').mockRejectedValueOnce(new Error('Download failed'));

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
    expect(mockBee.downloadFile).toHaveBeenCalled();
  });

  it('should handle missing forks gracefully in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = { forks: null } as any; // Simulate missing forks

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
  });
});
