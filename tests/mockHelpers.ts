import { Bee, Reference, Topic } from '@ethersphere/bee-js';
import { TextDecoder, TextEncoder } from 'util';

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

    // @ts-expect-error: downloadFile signature may not match Bee's exact type
    downloadFile: jest.fn((reference: string) => {
      console.log(`Mock downloadFile called with reference: ${reference}`);
      return Promise.resolve({
        data: {
          text: () => 'Mock content',
          hex: () => 'Mock hex content',
          json: () => ({ mockKey: 'mockValue' }),
        },
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
    makeFeedReader: jest.fn(() => {
      console.log('Mock makeFeedReader called');
      return {
        download: jest.fn().mockResolvedValue({
          reference: 'c'.repeat(64) as Reference,
          feedIndexNext: 1,
        })
      };
    }),

    makeFeedTopic: jest.fn(() => {
      console.log('Mock makeFeedTopic called');
      return "0000000000000000000000000000000000000000000000000000000000000000" as Topic;
    }),

    url: 'http://localhost:1633',
    requestOptions: {},
  };
}

export function createMockMantarayNode(customForks: Record<string, any> = {}): any {
  const defaultForks: { [key: string]: any } = {
    file: {
      prefix: encodePathToBytes('file'),
      node: {
        forks: {
          '1.txt': {
            prefix: encodePathToBytes('1.txt'),
            node: {
              isValueType: () => true,
              getEntry: new Uint8Array(Buffer.from('a'.repeat(64), 'hex')),
              metadata: { Filename: '1.txt', 'Content-Type': 'text/plain' },
            },
          },
          '2.txt': {
            prefix: encodePathToBytes('2.txt'),
            node: {
              isValueType: () => true,
              getEntry: new Uint8Array(Buffer.from('b'.repeat(64), 'hex')),
              metadata: { Filename: '2.txt', 'Content-Type': 'text/plain' },
            },
          },
        },
        isValueType: () => false,
      },
    },
  };

  return {
    forks: customForks || defaultForks,
    addFork: jest.fn((path: Uint8Array, reference: Uint8Array) => {
      const decodedPath = new TextDecoder().decode(path);
      console.log(`Mock addFork called with path: ${decodedPath}`);
      defaultForks[decodedPath] = {
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

function encodePathToBytes(path: string): Uint8Array {
  return path ? new TextEncoder().encode(path) : new Uint8Array();
}
