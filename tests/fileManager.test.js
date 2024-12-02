const FileManager = require('../src/fileManager');
const { createMockBee, createMockMantarayNode } = require('./mockHelpers');

jest.mock('mantaray-js', () => ({
  MantarayNode: jest.fn(() => createMockMantarayNode()),
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

  it('should create a new MantarayNode', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = fileManager.createMantarayNode();
    expect(mantaray).toBeTruthy();
  });

  it('should upload a file and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const result = await fileManager.uploadFile(
      { name: 'nested-dir/file1.txt', content: 'Test Content' },
      'test-stamp'
    );

    expect(result).toBe('mocked-reference-nested-dir/file1.txt');
    expect(mockBee.uploadFile).toHaveBeenCalledWith(
      'test-stamp',
      expect.any(Buffer),
      'nested-dir/file1.txt'
    );
  });

  it('should add a file to the Mantaray node', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = new MantarayNode();

    fileManager.addToMantaray(mantaray, 'mocked-reference', { Filename: 'test.txt' });
    expect(mantaray.addFork).toHaveBeenCalled();
  });

  it('should save a Mantaray node and return its reference', async () => {
    const fileManager = new FileManager('http://localhost:1633');
    fileManager.bee = mockBee;

    const mantaray = new MantarayNode();
    const result = await fileManager.saveMantaray(mantaray, 'test-stamp');

    expect(result).toBe('mocked-manifest-reference');
    expect(mockBee.uploadData).toHaveBeenCalled();
  });

  it('should list all files in a Mantaray node', () => {
    const fileManager = new FileManager('http://localhost:1633');
    const mantaray = new MantarayNode();

    const result = fileManager.listFiles(mantaray);
    expect(result).toEqual([]);
  });
});
