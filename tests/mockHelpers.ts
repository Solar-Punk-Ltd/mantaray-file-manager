import { Bee, Reference, Topic, Utils } from '@ethersphere/bee-js';

export function createMockBee(): Partial<Bee> {
  return {
    // @ts-expect-error: uploadFile signature may not match Bee's exact type
    uploadFile: jest.fn((stamp: string, fileData: Uint8Array, fileName?: string) => {
      console.log(`Mock uploadFile called with fileName: ${fileName}`);
      return Promise.resolve({
        reference: 'a'.repeat(64),
        cid: 'mocked-cid',
        historyAddress: 'mocked-history-address',
      });
    }),

    // @ts-expect-error: uploadData signature may not match Bee's exact type
    uploadData: jest.fn((stamp: string, data: Uint8Array) => {
      console.log('Mock uploadData called');
      return Promise.resolve({
        reference: 'b'.repeat(64) as Reference,
        historyAddress: 'mocked-history-address',
      });
    }),

    // @ts-expect-error: getPostageBatch signature may not match Bee's exact type
    getPostageBatch: jest.fn((batchId: string) => {
      if (batchId === 'test-stamp' || batchId.toString() === 'test-stamp') {
        return Promise.resolve({
          exists: true,
          usable: true,
          batchID: batchId,
          utilization: 0,
          depth: 17,
          amount: '1000',
          batchTTL: 1000000,
        });
      }
      return Promise.resolve(undefined); // Return undefined for unmatched batch IDs
    }),

    // @ts-expect-error: downloadFile signature may not match Bee's exact type
    downloadFile: jest.fn((reference: string) => {
      console.log(`Mock downloadFile called with reference: ${reference}`);

      // Return different content and metadata based on the reference
      const mockContentMap: Record<string, { data: string; metadata: any }> = {
        [Buffer.from('a'.repeat(64), 'hex').toString('hex')]: {
          data: 'Mock content for aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          metadata: {
            Filename: '1.txt',
            'Content-Type': 'text/plain',
          },
        },
        [Buffer.from('b'.repeat(64), 'hex').toString('hex')]: {
          data: 'Mock content for bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          metadata: {
            Filename: '2.txt',
            'Content-Type': 'text/plain',
          },
        },
      };

      const result = mockContentMap[reference] || { data: 'Unknown content', metadata: {} };

      return Promise.resolve({
        data: new Uint8Array(Buffer.from(result.data)),
        metadata: result.metadata,
      });
    }),

    getAllPins: jest.fn(() => {
      console.log('Mock getAllPins called');
      return Promise.resolve([
        '79ed514ec2da96ef7b7a64f55e1e4470cc163c7d4dbd5cbdf8a9fd4ab3993d94',
        '8d12623989dd6f6f899209c5029c7cba8b36c408b4106a21b407523c27af1f34',
        'df5c87236b99ef474de7936d74d0e6df0b6cd3c66ad27ac45e6eb081459e3708',
      ] as Reference[]);
    }),

    // @ts-expect-error: makeFeedReader signature may not match Bee's exact type
    makeFeedWriter: jest.fn(() => {
      console.log('Mock makeFeedWriter called');
      return {
        upload: jest.fn().mockResolvedValue({
          reference: 'mocked-feed-reference',
        }),
      };
    }),

    // @ts-expect-error: makeFeedReader signature may not match Bee's exact type
    makeFeedReader: jest.fn(() => {
      console.log('Mock makeFeedReader called');
      return {
        download: jest.fn().mockResolvedValue({
          reference: 'c'.repeat(64) as Reference,
          feedIndexNext: 1,
        }),
      };
    }),

    makeFeedTopic: jest.fn(() => {
      console.log('Mock makeFeedTopic called');
      return '0000000000000000000000000000000000000000000000000000000000000000' as Topic;
    }),

    url: 'http://localhost:1633',
    requestOptions: {},
  };
}

export function createMockMantarayNode(customForks: Record<string, any> = {}, excludeDefaultForks = false): any {
  const defaultForks: Record<string, any> = {
    file: {
      prefix: Utils.hexToBytes('file'),
      node: {
        forks: {
          '1.txt': {
            prefix: Utils.hexToBytes('1.txt'),
            node: {
              isValueType: () => true,
              getEntry: 'a'.repeat(64), // Valid Uint8Array
              getMetadata: {
                Filename: '1.txt',
                'Content-Type': 'text/plain',
              },
            },
          },
          '2.txt': {
            prefix: Utils.hexToBytes('2.txt'),
            node: {
              isValueType: () => true,
              getEntry: 'b'.repeat(64), // Valid Uint8Array
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

  // Conditionally include default forks
  const forks = excludeDefaultForks ? customForks : { ...defaultForks, ...customForks };

  return {
    forks,
    addFork: jest.fn((path: Uint8Array, reference: Uint8Array) => {
      const decodedPath = Utils.bytesToHex(path);
      console.log(`Mock addFork called with path: ${decodedPath}`);
      forks[decodedPath] = {
        prefix: path,
        node: { isValueType: () => true, getEntry: reference },
      };
    }),
    save: jest.fn(async (callback: any) => {
      console.log('Mock save called');
      const mockData = new Uint8Array(Buffer.from('mocked-mantaray-data'));
      return callback(mockData);
    }),
  };
}
