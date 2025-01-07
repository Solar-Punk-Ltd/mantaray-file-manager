const FileManager = require('../src/fileManager');
const { createMockBee, createMockMantarayNode } = require('./mockHelpers');
const { encodePathToBytes } = require('../src/utils');

jest.mock('mantaray-js', () => {
  const { createMockMantarayNode } = require('./mockHelpers');
  return {
    MantarayNode: jest.fn(() => createMockMantarayNode()),
  };
});

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => Buffer.from('Mock file content')),
}));

describe('FileManager - initializeFeed', () => {
  let fileManager;
  let mockBee;

  beforeEach(() => {
    mockBee = createMockBee();
    const MOCK_PRIVATE_KEY = '0x' + 'a'.repeat(64);
    fileManager = new FileManager('http://localhost:1633', MOCK_PRIVATE_KEY);
    fileManager.bee = mockBee;
    fileManager.mantaray = createMockMantarayNode();
    
    jest.clearAllMocks();
    console.log = jest.fn();  // Mock console.log
    console.error = jest.fn(); // Mock console.error
  });  

  it('should create a new feed if it does not exist', async () => {
    mockBee.downloadFile.mockRejectedValueOnce({ code: 404, message: 'feed not found' });

    await expect(fileManager.initializeFeed('test-stamp')).resolves.not.toThrow();
    expect(fileManager.mantaray).toBeDefined();
  });
  
  it('should upload a file, update the feed, and fetch the correct data', async () => {
    const filePath = 'nested-dir/file1.txt';
  
    // Initialize feed to set up the wallet
    await fileManager.initializeFeed('test-stamp');
  
    const uploadReference = await fileManager.uploadFile(filePath, fileManager.mantaray, 'test-stamp');
    await fileManager.saveFeed('test-stamp');
    const fetchedReference = await fileManager.fetchFeed();
  
    expect(fetchedReference).toBe(uploadReference);
  });  

  it('should handle missing feed gracefully and create a new Mantaray structure', async () => {
    mockBee.downloadFile.mockRejectedValueOnce({ code: 404, message: 'feed not found' });

    await expect(fileManager.initializeFeed('test-stamp')).resolves.not.toThrow();
    expect(fileManager.mantaray).toBeDefined();
  });

  it('should deserialize mantaray structure if feed exists', async () => {
    const mockManifestData = Buffer.from('mock-manifest-data');
  
    // Mock the feed reader and downloadData response
    mockBee.makeFeedReader().download.mockResolvedValueOnce({ reference: 'a'.repeat(64) });
    mockBee.downloadData.mockResolvedValueOnce(mockManifestData);
  
    // Spy on the deserialize method of the mock mantaray node
    const deserializeSpy = jest.spyOn(fileManager.mantaray, 'deserialize');
  
    await fileManager.initializeFeed('test-stamp');
  
    expect(mockBee.makeFeedReader().download).toHaveBeenCalled();
    expect(mockBee.downloadData).toHaveBeenCalledWith('a'.repeat(64));
    expect(deserializeSpy).toHaveBeenCalledWith(Buffer.from(mockManifestData));
    expect(console.log).toHaveBeenCalledWith('Mantaray structure initialized from feed.');
  });

  it('should throw an error if wallet is not initialized in fetchFeed', async () => {
    fileManager.wallet = undefined; // Ensure wallet is not initialized
  
    await expect(fileManager.fetchFeed()).rejects.toThrow(
      'Wallet not initialized. Please call initializeFeed first.'
    );
  });

  it('should handle errors when fetching feed fails', async () => {
    await fileManager.initializeFeed('test-stamp'); // Ensure wallet is initialized
  
    const feedReader = mockBee.makeFeedReader(); // Store the returned object
    feedReader.download.mockRejectedValueOnce(new Error('Mock download error')); // Properly mock rejection
  
    await expect(fileManager.fetchFeed()).rejects.toThrow('Could not fetch feed reference');
    expect(console.error).toHaveBeenCalledWith('Failed to fetch feed:', 'Mock download error');
  });  
});

describe('FileManager - importFileReferences', () => {
  let fileManager;
  let mockBee;

  beforeEach(() => {
    mockBee = createMockBee();
    fileManager = new FileManager('http://localhost:1633');
    fileManager.importedFiles = [];
    jest.clearAllMocks();
  });

  it('should call importPinnedReferences during initialization', async () => {
    const importPinnedReferencesSpy = jest.spyOn(fileManager, 'importPinnedReferences').mockResolvedValue();
    await fileManager.importFileReferences();

    expect(importPinnedReferencesSpy).toHaveBeenCalledTimes(1);
  });

  it('should import local references when items array is provided', async () => {
    const items = [{ hash: 'c'.repeat(64) }, { hash: 'd'.repeat(64) }];
    const importLocalReferencesSpy = jest.spyOn(fileManager, 'importLocalReferences').mockResolvedValue();
    
    await fileManager.importFileReferences(items);
    
    expect(importLocalReferencesSpy).toHaveBeenCalledWith(items);
    expect(console.log).toHaveBeenCalledWith('Using provided items for initialization.');
  });

  it('should log an error if importFileReferences fails', async () => {
    jest.spyOn(fileManager, 'importLocalReferences').mockRejectedValue(new Error('Mock import error'));
    console.error = jest.fn();
  
    await expect(fileManager.importFileReferences([{ hash: 'c'.repeat(64) }])).rejects.toThrow('Mock import error');
    expect(console.error).toHaveBeenCalledWith('[ERROR] Failed to import references: Mock import error');
  });

  it('should add all pinned references to Mantaray during initialization', async () => {
    const mockPins = [
        '79ed514ec2da96ef7b7a64f55e1e4470cc163c7d4dbd5cbdf8a9fd4ab3993d94',
        '8d12623989dd6f6f899209c5029c7cba8b36c408b4106a21b407523c27af1f34',
        'df5c87236b99ef474de7936d74d0e6df0b6cd3c66ad27ac45e6eb081459e3708',
    ];

    const mockBee = createMockBee();
    mockBee.getAllPins.mockResolvedValue(mockPins);

    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee; // Inject mockBee
    fileManager.mantaray = createMockMantarayNode(); // Inject mockMantarayNode

    jest.spyOn(fileManager.mantaray, 'addFork');

    // Run the initialize method
    await fileManager.importFileReferences();

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
            })
        );
    });
  });
  
  it('should log an error if importPinnedReferences fails', async () => {
    jest.spyOn(fileManager, 'importPinnedReferences').mockRejectedValue(new Error('Mock error during import'));
    console.error = jest.fn(); // Mock console.error
  
    await expect(fileManager.importFileReferences()).rejects.toThrow('Mock error during import');
    expect(console.error).toHaveBeenCalledWith('[ERROR] Failed to import references: Mock error during import');
  });  
});

describe('FileManager', () => {
  let mockBee;

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should throw an error if Bee URL is not provided', () => {
    expect(() => new FileManager()).toThrow('Bee URL is required for initializing the FileManager.');
  });

  it('should start with a valid Bee URL', () => {
    const fileManager = new FileManager('http://localhost:1633');
    expect(fileManager.bee).toBeTruthy();
    expect(fileManager.mantaray).toBeTruthy();
  });

  it('should upload a file and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const mockFilePath = 'nested-dir/file1.txt';
    const result = await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp', {}, '1');

    expect(result).toBe('a'.repeat(64));
    expect(mockBee.uploadFile).toHaveBeenCalledWith(
      'test-stamp',
      expect.any(Buffer),
      'file1.txt',
      {
        contentType: 'text/plain',
        headers: { 'swarm-redundancy-level': '1' },
      }
    );
  });

  it('should add a file to the Mantaray node', () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.addToMantaray(fileManager.mantaray, 'a'.repeat(64), { Filename: '1.txt' });

    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('1.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({ Filename: '1.txt' })
    );
  });

  it('should save a Mantaray node and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const result = await fileManager.saveMantaray(fileManager.mantaray, 'test-stamp');
    expect(result).toBe('a'.repeat(64));
    expect(mockBee.uploadFile).toHaveBeenCalledWith(
      'test-stamp',
      expect.any(Uint8Array),
      'manifest',
      { contentType: 'application/json' }
    );
  });

  it('should list files correctly in Mantaray', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const files = fileManager.listFiles(fileManager.mantaray, false); // Explicitly exclude metadata
  
    expect(files).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]);
  });  

  it('should download a specific file by path', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const content = await fileManager.downloadFile(fileManager.mantaray, 'file/1.txt');
    expect(content.data).toBe('Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(mockBee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('should handle missing files gracefully', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    await expect(fileManager.downloadFile(mantaray, 'file/3.txt')).rejects.toThrow(
      'Path segment not found: 3.txt'
    );
  });

  it('should handle missing forks gracefully in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = { forks: null };

    const files = fileManager.listFiles(mantaray);
    expect(files).toEqual([]);
  });

  it('should throw an error if a path segment is not found', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    jest.spyOn(fileManager, 'listFiles').mockReturnValue(['file/unknown.txt']);

    await expect(fileManager.downloadFile(mantaray, 'file/unknown.txt')).rejects.toThrow(
      'Path segment not found: unknown.txt'
    );
  });

  it('should handle errors during saveMantaray', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    jest.spyOn(mockBee, 'uploadFile').mockRejectedValueOnce(new Error('Upload failed'));

    await expect(fileManager.saveMantaray(fileManager.mantaray, 'test-stamp')).rejects.toThrow('Upload failed');
  });

  it('should handle invalid file uploads gracefully', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    jest.spyOn(mockBee, 'uploadFile').mockRejectedValueOnce(new Error('BatchId not valid hex string of length 64: test-stamp'));

    await expect(fileManager.uploadFile('invalid-path', mantaray, 'test-stamp')).rejects.toThrow(
      'BatchId not valid hex string of length 64: test-stamp'
    );
  });

  it('should handle nested paths correctly in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633');
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
    };
  
    const mantaray = createMockMantarayNode(customForks);
    const files = fileManager.listFiles(mantaray, false); // Exclude metadata
  
    expect(files).toEqual([{ path: 'nested/file.txt' }]);
  });  

  it('should handle the case where a path does not point to a file in downloadFile', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    jest.spyOn(fileManager, 'listFiles').mockReturnValue(['file/1.txt', 'file/2.txt']);
    jest.spyOn(mantaray.forks.file.node.forks['1.txt'].node, 'isValueType').mockReturnValue(false);

    await expect(fileManager.downloadFile(mantaray, 'file/1.txt')).rejects.toThrow(
      'Path does not point to a file: file/1.txt'
    );
  });

  it('should correctly handle download errors in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const mantaray = createMockMantarayNode();
    jest.spyOn(mockBee, 'downloadFile').mockRejectedValueOnce(new Error('Download failed'));

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
    expect(mockBee.downloadFile).toHaveBeenCalled();
  });

  it('should ensure metadata is not duplicated in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    const files = fileManager.listFiles(mantaray, true); // Explicitly include metadata
  
    expect(files).toEqual([
      {
        path: 'file/1.txt',
        metadata: {
          'Filename': '1.txt',
          'Content-Type': 'text/plain',
        },
      },
      {
        path: 'file/2.txt',
        metadata: {
          'Filename': '2.txt',
          'Content-Type': 'text/plain',
        },
      },
    ]);
  });  

  it('should ensure metadata is preserved during addToMantaray', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    const customMetadata = { 'Author': 'Test Author' };
    fileManager.addToMantaray(mantaray, 'a'.repeat(64), customMetadata);

    expect(mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file'),
      expect.any(Uint8Array),
      expect.objectContaining({
        'Author': 'Test Author',
        'Filename': 'file',
      })
    );
  });
  
  it('should download all files from Mantaray', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
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
    };
  
    const mantaray = createMockMantarayNode(mockForks);
    await fileManager.downloadFiles(mantaray);
  
    expect(mockBee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
    expect(mockBee.downloadFile).toHaveBeenCalledWith('b'.repeat(64));
  });
  
  it('should list files correctly even when prefix is undefined', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    mantaray.forks.file.prefix = undefined; // Simulate undefined prefix
    const files = fileManager.listFiles(mantaray, false); // Exclude metadata
  
    expect(files).toEqual([
      { path: 'file/1.txt' }, // Update to reflect corrected paths
      { path: 'file/2.txt' },
    ]);
  });  

  it('should add a file to the Mantaray node with default filename', () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.addToMantaray(fileManager.mantaray, 'a'.repeat(64), {});
  
    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file'),
      expect.any(Uint8Array),
      expect.objectContaining({ Filename: 'file' })
    );
  });
  
  it('should handle missing forks gracefully in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = { forks: null }; // Simulate missing forks
  
    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
  });
  
  it('should add metadata to Mantaray for uploaded files', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mockFilePath = 'nested-dir/file1.txt';
    const customMetadata = { description: 'Test description', tags: ['test'] };
  
    await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp', customMetadata, '2');
  
    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file1.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({
        'Filename': 'file1.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify(customMetadata),
      })
    );
  });
  
  it('should use default metadata when custom metadata is not provided', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mockFilePath = 'nested-dir/file2.txt';
  
    await fileManager.uploadFile(mockFilePath, fileManager.mantaray, 'test-stamp');
  
    expect(fileManager.mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file2.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({
        'Filename': 'file2.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify({}),
      })
    );
  });
  
  it('should return metadata with file data during download', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
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
                  'Filename': '1.txt',
                  'Content-Type': 'text/plain',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    };
  
    const mantaray = createMockMantarayNode(mockForks);
    const result = await fileManager.downloadFile(mantaray, 'file/1.txt');
  
    expect(result).toEqual({
      data: 'Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      metadata: {
        'Filename': '1.txt',
        'Content-Type': 'text/plain',
      },
    });
  });
  
  it('should list files with metadata in custom forks', () => {
    const fileManager = new FileManager('http://localhost:1633');
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
                  'Filename': 'file3.txt',
                  'Content-Type': 'application/json',
                },
              },
            },
          },
          isValueType: () => false,
        },
      },
    };
  
    const mantaray = createMockMantarayNode(customForks);
    const files = fileManager.listFiles(mantaray, true); // Explicitly include metadata
  
    expect(files).toEqual([
      {
        path: 'custom/file3.txt',
        metadata: {
          'Filename': 'file3.txt',
          'Content-Type': 'application/json',
        },
      },
    ]);
  });  
});
