const FileManager = require('../src/fileManager');

describe('FileManager', () => {
  it('should throw an error if Bee URL is not provided', () => {
    expect(() => new FileManager()).toThrow('Bee URL is required for initializing the FileManager.');
  });

  // Add more tests for each method
});