import { BatchId, Bee, Data, Utils } from '@ethersphere/bee-js';
import { Wallet } from 'ethers';

export const BEE_URL = 'http://localhost:1633';
export const DEFAULT_BATCH_DEPTH = 22;
export const DEFAULT_BATCH_AMOUNT = '1200000000';
export const MOCK_PRIV_KEY = '634fb5a872396d9693e5c9f9d7233cfa93f395c093371017ff44aa9ae6564cdd';
export const MOCK_WALLET = new Wallet(MOCK_PRIV_KEY);
export const MOCK_SIGNER = {
  address: Utils.hexToBytes(MOCK_WALLET.address.slice(2)),
  sign: async (data: Data): Promise<string> => {
    return await MOCK_WALLET.signMessage(data);
  },
};

export async function buyStamp(bee: Bee, label?: string): Promise<BatchId> {
  return await bee.createPostageBatch(DEFAULT_BATCH_AMOUNT, DEFAULT_BATCH_DEPTH, {
    waitForUsable: true,
    label: label,
  });
}
