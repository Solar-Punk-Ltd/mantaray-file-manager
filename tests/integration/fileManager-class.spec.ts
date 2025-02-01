import { Bee, Reference, Topic, Utils } from '@ethersphere/bee-js';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MantarayNode } from '@solarpunkltd/mantaray-js';

import { OWNER_FEED_STAMP_LABEL, REFERENCE_LIST_TOPIC, SWARM_ZERO_ADDRESS } from '../../src/constants';
import { FileManager } from '../../src/fileManager';
import { encodePathToBytes, makeBeeRequestOptions } from '../../src/utils';
import { BEE_URL, buyStamp, MOCK_PRIV_KEY, MOCK_WALLET } from '../utils';

jest.mock('fs', () => {
  const mockBuffer = jest.fn(() => Buffer.from('Mock file content'));
  return {
    readFileSync: mockBuffer,
  };
});

describe('FileManager instantiation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should create and initialize a new instance', async () => {
    const bee = new Bee(BEE_URL);
    // const f = async (): Promise<any> => new FileManager(bee, MOCK_PK);
    // const fileManager = (await f()) as FileManager;
    const fileManager = new FileManager(bee, MOCK_PRIV_KEY);
    try {
      await fileManager.initialize();
    } catch (error: any) {
      expect(error).toEqual('Owner stamp not found');
    }
    const stamps = await fileManager.getStamps();
    expect(stamps).toEqual([]);
    expect(fileManager.getFileInfoList()).toEqual([]);
  });

  // TODO: test if no-one else can read the topic but the owner
  it('should fetch the owner stamp and initialize the owner feed', async () => {
    const bee = new Bee(BEE_URL);
    const batchId = await buyStamp(bee, OWNER_FEED_STAMP_LABEL);
    const fileManager = new FileManager(bee, MOCK_PRIV_KEY);
    const mockPubKey = (await bee.getNodeAddresses()).publicKey;
    await fileManager.initialize();

    const stamps = await fileManager.getStamps();
    expect(stamps[0].batchID).toEqual(batchId);
    expect(stamps[0].label).toEqual(OWNER_FEED_STAMP_LABEL);
    expect(fileManager.getCachedStamp(batchId)).toEqual(stamps[0]);
    expect(fileManager.getFileInfoList()).toEqual([]);

    const referenceListTopicHex = bee.makeFeedTopic(REFERENCE_LIST_TOPIC);
    const feedTopicData = await fileManager.getFeedData(referenceListTopicHex, MOCK_WALLET.address, 0);
    const topicHistory = await fileManager.getFeedData(referenceListTopicHex, MOCK_WALLET.address, 1);
    const options = makeBeeRequestOptions(topicHistory.reference, mockPubKey);
    // TODO: fails here
    const topicHex = (await bee.downloadData(feedTopicData.reference, options)).text() as Topic;
    expect(topicHex !== SWARM_ZERO_ADDRESS).toBeTruthy();
    console.log('owner feed topicHex: ', topicHex);
  });
});
