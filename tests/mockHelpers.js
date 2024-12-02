const { MantarayNode } = require('mantaray-js');

function createMockBee() {
  return {
    uploadFile: jest.fn((stamp, fileData, fileName) => {
      console.log(`Mock uploadFile called with: ${fileName}`);
      return Promise.resolve({ reference: 'mocked-reference-' + fileName });
    }),
    uploadData: jest.fn((stamp, data) => {
      console.log("Mock uploadData called");
      return Promise.resolve({ reference: 'mocked-manifest-reference' });
    }),
  };
}

function createMockMantarayNode() {
  const forks = {};

  return {
    forks,
    addFork: jest.fn((path, reference) => {
      console.log(`Mock addFork called with path: ${new TextDecoder().decode(path)}`);
      forks[path[0]] = { prefix: path, node: { isValueType: () => true } };
    }),
    save: jest.fn(async (callback) => {
      console.log("Mock save called");
      return callback(new Uint8Array([1, 2, 3]));
    }),
  };
}

module.exports = {
  createMockBee,
  createMockMantarayNode,
};
