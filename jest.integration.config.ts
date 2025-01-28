export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/integration-tests/**/*.e2e.test.ts'],
  globalSetup: '<rootDir>/tests/integration-tests/test-node-setup/jestSetup.ts',
  globalTeardown: '<rootDir>/tests/integration-tests/test-node-setup/jestTeardown.ts',
  verbose: true,
  testTimeout: 30000, // Increase timeout to 30 seconds
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
