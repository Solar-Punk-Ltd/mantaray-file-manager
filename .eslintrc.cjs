module.exports = {
  env: {
    node: true, // Node.js environment
    jest: true, // Jest environment
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script', // CommonJS mode
  },
  globals: {
    require: 'readonly',
    module: 'readonly',
    Buffer: 'readonly',
    process: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    jest: 'readonly',
    describe: 'readonly',
    it: 'readonly',
    expect: 'readonly',
    beforeEach: 'readonly',
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'error',
  },
};
