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

describe('FileManager', () => {
  let mockBee;

  beforeEach(() => {
    mockBee = createMockBee();
    jest.clearAllMocks();
  });

  it('should throw an error if Bee URL is not provided', () => {
    expect(() => new FileManager()).toThrow('Bee URL is required for initializing the FileManager.');
  });

  it('should initialize with a valid Bee URL', () => {
    const fileManager = new FileManager('http://localhost:1633');
    expect(fileManager.bee).toBeTruthy();
  });

  it('should upload a file and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mantaray = createMockMantarayNode();
    const mockFilePath = 'nested-dir/file1.txt';
    const result = await fileManager.uploadFile(mockFilePath, mantaray, 'test-stamp', {}, '1');
  
    expect(result).toBe('b'.repeat(64)); // Valid 64-character hex string
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
    const mantaray = createMockMantarayNode();
  
    fileManager.addToMantaray(mantaray, 'a'.repeat(64), { Filename: '1.txt' });
  
    expect(mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('1.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({ Filename: '1.txt' })
    );
  });  

  it('should save a Mantaray node and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mantaray = createMockMantarayNode();
    const result = await fileManager.saveMantaray(mantaray, 'test-stamp');
  
    expect(result).toBe('b'.repeat(64)); // Valid 64-character hex string
    expect(mockBee.uploadFile).toHaveBeenCalledTimes(1);
    expect(mockBee.uploadFile).toHaveBeenCalledWith(
      'test-stamp',
      expect.any(Uint8Array),
      'manifest',
      { contentType: 'application/json' } // Correct headers for Mantaray save
    );
  });  

  it('should list files correctly in Mantaray', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    const files = fileManager.listFiles(mantaray);
    expect(files).toEqual([
      { path: 'file/1.txt' },
      { path: 'file/2.txt' },
    ]); // Correct expectation
  });
  
  it('should download a specific file by path', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mantaray = createMockMantarayNode();
    const content = await fileManager.downloadFile(mantaray, 'file/1.txt');
  
    expect(content.data).toBe('Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(mockBee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
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
    const files = fileManager.listFiles(mantaray);
  
    expect(files).toEqual([{ path: 'nested/file.txt' }]); // Correct expectation
  });   

  it('should download all files from Mantaray', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const mantaray = createMockMantarayNode();
    await fileManager.downloadFiles(mantaray);

    expect(mockBee.downloadFile).toHaveBeenCalledWith('a'.repeat(64));
    expect(mockBee.downloadFile).toHaveBeenCalledWith('b'.repeat(64));
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
    const mantaray = { forks: null }; // Simulating missing forks

    const files = fileManager.listFiles(mantaray);
    expect(files).toEqual([]); // Should return an empty list
  });

  it('should throw an error if a path segment is not found', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    jest.spyOn(fileManager, 'listFiles').mockReturnValue(['file/unknown.txt']); // Mock files list

    await expect(fileManager.downloadFile(mantaray, 'file/unknown.txt')).rejects.toThrow(
      'Path segment not found: unknown.txt'
    );
  });

  it('should handle errors during saveMantaray', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const mantaray = createMockMantarayNode();
    jest.spyOn(mockBee, 'uploadFile').mockRejectedValueOnce(new Error('Upload failed'));

    await expect(fileManager.saveMantaray(mantaray, 'test-stamp')).rejects.toThrow('Upload failed');
  });

  it('should handle invalid file uploads gracefully', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();

    jest.spyOn(mockBee, 'uploadFile').mockRejectedValueOnce(new Error('BatchId not valid hex string of length 64: test-stamp'));

    await expect(fileManager.uploadFile('invalid-path', mantaray, 'test-stamp')).rejects.toThrow(
      'BatchId not valid hex string of length 64: test-stamp'
    );
  });
  
  it('should list files correctly even when prefix is undefined', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    mantaray.forks.file.prefix = undefined; // Simulate undefined prefix
    const files = fileManager.listFiles(mantaray);
    expect(files).toEqual([
      { path: '1.txt' },
      { path: '2.txt' },
    ]); // Ensure paths are correctly handled
  });
  
  it('should add a file to the Mantaray node with default filename', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    fileManager.addToMantaray(mantaray, 'a'.repeat(64), {}); // No Filename in metadata
  
    expect(mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file'),
      expect.any(Uint8Array),
      expect.objectContaining({ Filename: 'file' })
    );
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

  it('should handle missing forks gracefully in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = { forks: null }; // Simulate missing forks

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
  });

  it('should correctly handle download errors in downloadFiles', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const mantaray = createMockMantarayNode();
    jest.spyOn(mockBee, 'downloadFile').mockRejectedValueOnce(new Error('Download failed'));

    await expect(fileManager.downloadFiles(mantaray)).resolves.toBeUndefined();
    expect(mockBee.downloadFile).toHaveBeenCalled();
  });

  it('should add metadata to Mantaray for uploaded files', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mantaray = createMockMantarayNode();
    const mockFilePath = 'nested-dir/file1.txt';
    const customMetadata = { description: 'Test description', tags: ['test'] };
  
    await fileManager.uploadFile(mockFilePath, mantaray, 'test-stamp', customMetadata, '2');
  
    expect(mantaray.addFork).toHaveBeenCalledWith(
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
  
    const mantaray = createMockMantarayNode();
    const mockFilePath = 'nested-dir/file2.txt';
  
    await fileManager.uploadFile(mockFilePath, mantaray, 'test-stamp');
  
    expect(mantaray.addFork).toHaveBeenCalledWith(
      encodePathToBytes('file2.txt'),
      expect.any(Uint8Array),
      expect.objectContaining({
        'Filename': 'file2.txt',
        'Content-Type': 'text/plain',
        'Custom-Metadata': JSON.stringify({}),
      })
    );
  });

  it('should list files with metadata', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    const files = fileManager.listFiles(mantaray, '', true);
  
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

  it('should return metadata with file data during download', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;
  
    const mantaray = createMockMantarayNode();
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
    const files = fileManager.listFiles(mantaray, '', true);
  
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

  it('should ensure metadata is not duplicated in listFiles', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = createMockMantarayNode();
  
    const files = fileManager.listFiles(mantaray, '', true);
  
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
        'Filename': 'file', // Default Filename should still be included
      })
    );
  });  
});
