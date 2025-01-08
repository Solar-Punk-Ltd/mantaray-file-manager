import { Bee, Reference, Utils } from '@ethersphere/bee-js';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { hexlify } from 'ethers';

import { FileManager } from '../src/fileManager';
import { encodePathToBytes } from '../src/utils';

import { createMockBee, createMockMantarayNode } from './mockHelpers';

jest.mock('mantaray-js', () => {
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

describe('FileManager - initialize', () => {
  let fileManager: FileManager;
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.importedFiles = [];
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
        expect.any(Uint8Array), // Reference (encoded pin)
        expect.objectContaining({
          Filename: `pinned-${pin.substring(0, 6)}`,
          pinned: true,
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

describe('FileManager', () => {
  let mockBee: ReturnType<typeof createMockBee>;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should throw an error if Bee URL is not provided', () => {
    expect(() => new FileManager('http://localhost:1633', 'privateKey')).toThrow(
      'privateKey is required for initializing the FileManager.',
    );
  });

  it('should throw an error if privatekey is not provided', () => {
    expect(() => new FileManager('', '')).toThrow('Bee URL is required for initializing the FileManager.');
  });

  it('should initialize with a valid Bee URL', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    expect(fileManager.bee).toBeTruthy();
    expect(fileManager.mantaray).toBeTruthy();
  });

  it('should upload a file and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee;

    const mockFilePath = 'nested-dir/file1.txt';
    const result = await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp', {}, '1');

    expect(result).toBe('a'.repeat(64));
    expect(mockBee.uploadFile).toHaveBeenCalledWith('test-stamp', expect.any(Buffer), 'file1.txt', {
      contentType: 'text/plain',
      headers: { 'swarm-redundancy-level': '1' },
    });
  });

  it('should add a file to the Mantaray node', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.addToMantaray(fileManager.mantaray, 'a'.repeat(64), { Filename: '1.txt' });

    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('1.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({ Filename: '1.txt' }),
    );
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

  it('should list files correctly in Mantaray', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const files = fileManager.listFiles(fileManager.mantaray, false); // Explicitly exclude metadata

    expect(files).toEqual([{ path: 'file/1.txt' }, { path: 'file/2.txt' }]);
  });

  it('should download a specific file by path', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const content = await fileManager.downloadFile(fileManager.mantaray, 'file/1.txt');
    expect(content.data).toBe('Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(mockBee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('should handle missing files gracefully', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    await expect(fileManager.downloadFile(mantaray, 'file/3.txt')).rejects.toThrow('Path segment not found: 3.txt');
  });

  it('should handle missing forks gracefully in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = { forks: null } as any;

    const files = fileManager.listFiles(mantaray);
    expect(files).toEqual([]);
  });

  it('should throw an error if a path segment is not found', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    jest.spyOn(fileManager, 'listFiles').mockReturnValue([{ path: 'file/unknown.txt', metadata: {} }]);

    await expect(fileManager.downloadFile(mantaray, 'file/unknown.txt')).rejects.toThrow(
      'Path segment not found: unknown.txt',
    );
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

  it('should handle nested paths correctly in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const customForks = {
      nested: {
        prefix: encodePathToBytes('nested'),
        node: {
          forks: {
            'file.txt': {
              prefix: encodePathToBytes('file.txt'),
              node: {
                isValueType: () => true,
                getEntry: new Uint8Array(Buffer.from('c'.repeat(64), 'hex')),
              },
            },
          },
          isValueType: () => false,
        },
      },
    } as any;

    const mantaray = createMockMantarayNode(customForks) as any;
    const files = fileManager.listFiles(mantaray, false); // Exclude metadata

    expect(files).toEqual([{ path: 'nested/file.txt' }]);
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

  it('should correctly handle download errors in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const mantaray = createMockMantarayNode() as any;
    jest.spyOn(mockBee, 'downloadFile').mockRejectedValueOnce(new Error('Download failed'));

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
    expect(mockBee.downloadFile).toHaveBeenCalled();
  });

  it('should ensure metadata is not duplicated in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    const files = fileManager.listFiles(mantaray, true); // Explicitly include metadata

    expect(files).toEqual([
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

  it('should ensure metadata is preserved during addToMantaray', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    const customMetadata = { Author: 'Test Author' };
    fileManager.addToMantaray(mantaray, 'a'.repeat(64), customMetadata);

    expect(mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file'),
      expect.any(Uint8Array),
      expect.objectContaining({
        Author: 'Test Author',
        Filename: 'file',
      }),
    );
  });

  it('should download all files from Mantaray', async () => {
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
                getEntry: new Uint8Array(Buffer.from('a'.repeat(64), 'hex')),
              },
            },
            '2.txt': {
              prefix: encodePathToBytes('2.txt'),
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

  it('should list files correctly even when prefix is undefined', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = createMockMantarayNode() as any;

    mantaray.forks.file.prefix = undefined; // Simulate undefined prefix
    const files = fileManager.listFiles(mantaray, false); // Exclude metadata

    expect(files).toEqual([
      { path: 'file/1.txt' }, // Update to reflect corrected paths
      { path: 'file/2.txt' },
    ]);
  });

  it('should add a file to the Mantaray node with default filename', () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.addToMantaray(fileManager.mantaray, 'a'.repeat(64), {});

    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file'),
      expect.any(Uint8Array),
      expect.objectContaining({ Filename: 'file' }),
    );
  });

  it('should handle missing forks gracefully in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    const mantaray = { forks: null } as any; // Simulate missing forks

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
  });

  it('should add metadata to Mantaray for uploaded files', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const mockFilePath = 'nested-dir/file1.txt';
    const customMetadata = { description: 'Test description', tags: ['test'] };

    await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp', customMetadata, '2');

    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file1.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({
        Filename: 'file1.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify(customMetadata),
      }),
    );
  });

  it('should use default metadata when custom metadata is not provided', async () => {
    const fileManager = new FileManager('http://localhost:1633', privateKey);
    fileManager.bee = mockBee as unknown as Bee; // Inject mockBee

    const mockFilePath = 'nested-dir/file2.txt';

    await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp');

    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file2.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({
        Filename: 'file2.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify({}),
      }),
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
                getEntry: new Uint8Array(Buffer.from('a'.repeat(64), 'hex')),
                metadata: {
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
                metadata: {
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

    const mantaray = createMockMantarayNode(customForks) as any;
    const files = fileManager.listFiles(mantaray, true); // Explicitly include metadata

    expect(files).toEqual([
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
