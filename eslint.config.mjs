export default [
  {
    files: ['*.js', '*.test.js'], // Include test files too
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script', // CommonJS mode
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
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
];
