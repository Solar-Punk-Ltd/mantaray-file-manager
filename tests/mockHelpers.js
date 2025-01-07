const { TextDecoder, TextEncoder } = require('util');

// Mocking Bee functions
function createMockBee() {
  const downloadMock = jest.fn().mockResolvedValue({ reference: 'a'.repeat(64) });

  return {
    uploadFile: jest.fn((stamp, fileData, fileName) => {
      console.log(`Mock uploadFile called with fileName: ${fileName}`);
      return Promise.resolve({ reference: 'a'.repeat(64) });
    }),
    uploadData: jest.fn((stamp, data) => {
      console.log('Mock uploadData called');
      return Promise.resolve({ reference: 'b'.repeat(64) });
    }),
    downloadFile: jest.fn((reference) => {
      console.log(`Mock downloadFile called with reference: ${reference}`);
      return Promise.resolve({ data: Buffer.from(`Mock content for ${reference}`) });
    }),
    downloadData: jest.fn(),
    getAllPins: jest.fn(() => {
      console.log('Mock getAllPins called');
      return Promise.resolve([
        '79ed514ec2da96ef7b7a64f55e1e4470cc163c7d4dbd5cbdf8a9fd4ab3993d94',
        '8d12623989dd6f6f899209c5029c7cba8b36c408b4106a21b407523c27af1f34',
        'df5c87236b99ef474de7936d74d0e6df0b6cd3c66ad27ac45e6eb081459e3708',
      ]);
    }),
    makeFeedReader: jest.fn(() => ({
      download: downloadMock, // Properly mock the download method
    })),
    makeFeedWriter: jest.fn(() => ({
      upload: jest.fn(() => Promise.resolve({ reference: 'a'.repeat(64) })),
    })),
  };
}

// Mocking Wallet from ethers
jest.mock('ethers', () => ({
  Wallet: jest.fn().mockImplementation((privateKey) => ({
    privateKey,
    address: '0x' + 'b'.repeat(40),
    signMessage: jest.fn(() => Promise.resolve('mock-signature')),
  })),
}));

function createMockMantarayNode(customForks = null) {
  const defaultForks = {
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
          '2.txt': {
            prefix: encodePathToBytes('2.txt'),
            node: {
              isValueType: () => true,
              getEntry: new Uint8Array(Buffer.from('b'.repeat(64), 'hex')),
              metadata: {
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

  return {
    forks: customForks || defaultForks,
    addFork: jest.fn((path, reference) => {
      const decodedPath = path ? new TextDecoder().decode(path) : '';
      console.log(`Mock addFork called with path: ${decodedPath}`);
      defaultForks[decodedPath] = {
        prefix: path || undefined,
        node: { isValueType: () => true, getEntry: reference },
      };
    }),
    save: jest.fn(async (callback) => {
      console.log('Mock save called');
      const mockData = new Uint8Array(Buffer.from('mocked-mantaray-data'));
      const reference = await callback(mockData);
      return new Uint8Array(Buffer.from(reference, 'hex'));
    }),
    deserialize: jest.fn((data) => {
      console.log('Mock deserialize called with data:', data.toString());
      // Simulate deserializing by restoring the forks
      // This can be a no-op for simplicity unless specific behavior is needed
    }),
  };
}

function encodePathToBytes(path) {
  return path ? new TextEncoder().encode(path) : new Uint8Array();
}

module.exports = {
  createMockBee,
  createMockMantarayNode,
};
