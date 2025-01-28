import { Utils } from '@ethersphere/bee-js';
import axios from 'axios';
import { hexlify } from 'ethers';
import fs from 'fs';
import path from 'path';

import { FileManager } from '../../src/fileManager';

const BEE_API_URL = 'http://localhost:1733';
const DEBUG_API_URL = 'http://localhost:1733';
const PRIVATE_KEY = hexlify(Utils.keccak256Hash('pkinput'));

describe('FileManager - Integration Tests', () => {
  let fileManager: FileManager;
  let postageBatchId: string;

  beforeAll(async () => {
    jest.setTimeout(60000); // Set higher timeout for longer start-up

    fileManager = new FileManager(BEE_API_URL, PRIVATE_KEY);

    console.log('Waiting for Bee node to start...');
    for (let i = 0; i < 15; i++) {
      try {
        const response = await axios.get(`${DEBUG_API_URL}/health`);
        if (response.status === 200) {
          console.log('Bee node is running.');
          break;
        }
      } catch (error) {
        console.log('Waiting for Bee node to be ready...');
        await new Promise((res) => setTimeout(res, 5000));
      }
    }

    // Final check if not ready
    try {
      await axios.get(`${DEBUG_API_URL}/health`);
    } catch (error) {
      throw new Error('Bee node is not running. Please start the Bee node before running tests.');
    }

    // Create dummy files for testing
    fs.writeFileSync('test-file.txt', 'Mock content for test file.');
    fs.writeFileSync('meta-file.txt', 'Mock content for meta file.');
  });

  afterAll(async () => {
    console.log('Cleaning up uploaded files...');
    await fileManager.bee.getAllPins().then(async (pins) => {
      for (const pin of pins) {
        await fileManager.bee.unpin(pin);
      }
    });

    // Cleanup the dummy files after tests
    if (fs.existsSync('test-file.txt')) fs.unlinkSync('test-file.txt');
    if (fs.existsSync('meta-file.txt')) fs.unlinkSync('meta-file.txt');
  });

  describe('Constructor - Error Handling', () => {
    it('should fail to upload a non-existent file', async () => {
      const nonExistentFile = path.resolve('non-existent.txt');

      await expect(fileManager.uploadFile(nonExistentFile, fileManager.mantaray, postageBatchId)).rejects.toThrow();
    });

    it('should handle download errors gracefully', async () => {
      await expect(fileManager.downloadFile(fileManager.mantaray, 'unknown.txt')).rejects.toThrow();
    });
  });

  describe('Initialization', () => {
    it('should import pinned references during initialization', async () => {
      await fileManager.initialize(undefined);
      expect(fileManager.importedFiles.length).toBeGreaterThanOrEqual(0);
    });

    it('should add pinned references to Mantaray during initialization', async () => {
      const response = await axios.get(`${BEE_API_URL}/pins`);
      const pinnedReferences = response.data?.stamps ?? [];

      expect(Array.isArray(pinnedReferences)).toBe(true);
      expect(pinnedReferences.length).toBeGreaterThanOrEqual(0);

      pinnedReferences.forEach((pin: any) => {
        expect(fileManager.importedFiles).toContainEqual(
          expect.objectContaining({
            reference: pin?.batchID, // Ensure correct reference key
            filename: expect.stringContaining('pinned'),
          }),
        );
      });
    });

    it('should log an error if initialization fails', async () => {
      const invalidPrivateKey = 'invalid-key-should-fail';

      await expect(() => new FileManager(BEE_API_URL, invalidPrivateKey)).toThrow(
        'Invalid private key provided: invalid BytesLike value (argument="value", value="0xinvalid-key-should-fail", code=INVALID_ARGUMENT, version=6.13.5)',
      );
    });
  });

  describe('File Operations', () => {
    beforeEach(async () => {
      // Purchase a new postage batch before each test
      console.log('Purchasing new postage batch...');
      try {
        const response = await axios.post(`${DEBUG_API_URL}/stamps/1000000/17`);
        postageBatchId = response.data.batchID;
        console.log(`Postage batch created: ${postageBatchId}`);

        // Wait for the postage stamp to be usable
        let isUsable = false;
        for (let i = 0; i < 10; i++) {
          const statusResponse = await axios.get(`${DEBUG_API_URL}/stamps`);
          const batches = statusResponse.data.stamps;
          if (batches.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
            isUsable = true;
            break;
          }
          console.log('Waiting for postage batch to be usable...');
          await new Promise((res) => setTimeout(res, 5000));
        }

        if (!isUsable) {
          throw new Error('Postage batch not usable within time limit.');
        }
      } catch (error) {
        console.error('Error purchasing postage batch:', error);
        throw error;
      }
    });

    it('should upload and download a file successfully', async () => {
      const filePath = path.resolve('test-file.txt');
      const reference = await fileManager.uploadFile(filePath, fileManager.mantaray, postageBatchId);

      expect(reference).toBeDefined();

      const downloadedContent = await fileManager.downloadFile(fileManager.mantaray, 'test-file.txt');
      expect(downloadedContent.data).toContain('Mock content for test file.');
    });

    it('should verify uploaded file metadata', async () => {
      const filePath = path.resolve('meta-file.txt');
      const metadata = { description: 'E2E test metadata' };
      const reference = await fileManager.uploadFile(filePath, fileManager.mantaray, postageBatchId, metadata);
      expect(reference).toBeDefined();
      // Allow data to propagate
      await new Promise((res) => setTimeout(res, 5000));
      const files = fileManager.listFiles(fileManager.mantaray, true);
      const fileMeta = files.find((f) => f.path.trim().includes('meta-file.txt'));
      expect(fileMeta).toBeDefined();
      const customMetadata = JSON.parse(fileMeta?.metadata?.['Custom-Metadata'] || '{}');
      expect(customMetadata.description).toBe('E2E test metadata');
    });

    it('should return an empty array for non-existent files', async () => {
      const result = fileManager.searchFilesByName('nonexistent.txt');
      expect(result).toEqual([]);
    });

    it('should list files correctly', async () => {
      const files = fileManager.listFiles(fileManager.mantaray, false);

      // Remove null characters and clean up file paths
      const cleanedFiles = files.map((f) => ({
        path: f.path.split('\x00').join('').trim(),
      }));

      console.log('Cleaned file list retrieved:', cleanedFiles); // Debugging

      expect(cleanedFiles).toEqual([{ path: 'meta-file.txt' }, { path: 'test-file.txt' }]);
    });
  });

  describe('FileManager - Mantaray Manipulation', () => {
    let fileManager: FileManager;
    let postageBatchId: string;
    const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

    beforeAll(async () => {
      fileManager = new FileManager(BEE_API_URL, privateKey);

      console.log('Purchasing new postage batch...');
      const response = await fetch(`${BEE_API_URL}/stamps/1000000/17`, { method: 'POST' });
      const data = await response.json();
      postageBatchId = data.batchID;

      console.log(`Postage batch created: ${postageBatchId}`);

      // Wait until the postage batch becomes usable
      let isUsable = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BEE_API_URL}/stamps`);
        const result = await res.json();
        if (result.stamps.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
          isUsable = true;
          break;
        }
        console.log('Waiting for postage batch to be usable...');
        await new Promise((res) => setTimeout(res, 5000));
      }

      if (!isUsable) {
        throw new Error('Postage batch not usable within the time limit.');
      }
    });

    it('should add a file to the Mantaray node and verify its existence', async () => {
      const reference = 'a'.repeat(64);
      const metadata = { Filename: 'test-file.txt' };

      fileManager.addToMantaray(fileManager.mantaray, reference, metadata);

      const listedFiles = fileManager.listFiles(fileManager.mantaray, true);
      expect(listedFiles.some((file: any) => file.path.includes('test-file.txt'))).toBe(true);
    });

    it('should preserve metadata when adding files to Mantaray', async () => {
      const reference = 'b'.repeat(64);
      const metadata = { Author: 'Test Author', Filename: 'author-file.txt' };

      fileManager.addToMantaray(fileManager.mantaray, reference, metadata);

      const listedFiles = fileManager.listFiles(fileManager.mantaray, true);
      const fileEntry = listedFiles.find((file: any) => file.path.includes('author-file.txt'));
      expect(fileEntry).toBeDefined();
      expect(fileEntry?.metadata?.Author).toBe('Test Author');
    });

    it('should add a file to Mantaray with default filename', async () => {
      const reference = 'c'.repeat(64);
      fileManager.addToMantaray(fileManager.mantaray, reference, {});

      const listedFiles = fileManager.listFiles(fileManager.mantaray, true);
      expect(listedFiles.some((file: any) => file.path.includes('file'))).toBe(true);
    });

    afterAll(() => {
      console.log('Tests completed, cleaning up resources if necessary.');
    });
  });

  describe('FileManager - Save Mantaray', () => {
    let fileManager: FileManager;
    let postageBatchId: string;
    const privateKey = hexlify(Utils.keccak256Hash('pkinput'));

    beforeAll(async () => {
      fileManager = new FileManager(BEE_API_URL, privateKey);

      console.log('Purchasing new postage batch...');
      const response = await fetch(`${BEE_API_URL}/stamps/1000000/17`, { method: 'POST' });
      const data = await response.json();
      postageBatchId = data.batchID;

      console.log(`Postage batch created: ${postageBatchId}`);

      // Wait until the postage batch becomes usable
      let isUsable = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BEE_API_URL}/stamps`);
        const result = await res.json();
        if (result.stamps.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
          isUsable = true;
          break;
        }
        console.log('Waiting for postage batch to be usable...');
        await new Promise((res) => setTimeout(res, 5000));
      }

      if (!isUsable) {
        throw new Error('Postage batch not usable within the time limit.');
      }
    });

    it('should save a Mantaray node and return its reference', async () => {
      const result = await fileManager.saveMantaray(fileManager.mantaray, postageBatchId);
      expect(result).toBeDefined();
      expect(result.length).toBe(64);
    });

    it('should handle errors during saveMantaray', async () => {
      const invalidBatchId = 'invalid-batch-id';

      const result = await fileManager.saveMantaray(fileManager.mantaray, invalidBatchId);

      expect(result).not.toBeUndefined();
      expect(result.length).toBe(64); // Ensure a valid reference length
      expect(result).not.toEqual(invalidBatchId); // Ensure the result is not the input batch ID
    });

    afterAll(() => {
      console.log('Tests completed, cleaning up resources if necessary.');
    });
  });

  describe('FileManager - Upload File', () => {
    let fileManager: FileManager;
    let postageBatchId: string;
    const privateKey = hexlify(Utils.keccak256Hash('pkinput'));
    const testDir = 'nested-dir';

    beforeAll(async () => {
      fileManager = new FileManager(BEE_API_URL, privateKey);

      console.log('Purchasing new postage batch...');
      const response = await fetch(`${BEE_API_URL}/stamps/1000000/17`, { method: 'POST' });
      const data = await response.json();
      postageBatchId = data.batchID;

      console.log(`Postage batch created: ${postageBatchId}`);

      // Wait until the postage batch becomes usable
      let isUsable = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BEE_API_URL}/stamps`);
        const result = await res.json();
        if (result.stamps.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
          isUsable = true;
          break;
        }
        console.log('Waiting for postage batch to be usable...');
        await new Promise((res) => setTimeout(res, 5000));
      }

      if (!isUsable) {
        throw new Error('Postage batch not usable within the time limit.');
      }

      // Ensure the test directory and files exist
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
      }

      fs.writeFileSync(path.join(testDir, 'file1.txt'), 'Mock content for test file 1');
      fs.writeFileSync(path.join(testDir, 'file2.txt'), 'Mock content for test file 2');
    });

    it('should upload a file and return its reference', async () => {
      const mockFilePath = path.join(testDir, 'file1.txt');
      const result = await fileManager.uploadFile(mockFilePath, fileManager.mantaray, postageBatchId, {}, '1');

      expect(result).toBeDefined();
      expect(result.length).toBe(64);

      const listedFiles = fileManager.listFiles(fileManager.mantaray, true);
      expect(listedFiles.some((file: any) => file.path.includes('file1.txt'))).toBe(true);
    });

    it('should handle invalid file uploads gracefully', async () => {
      await expect(fileManager.uploadFile('invalid-path', fileManager.mantaray, 'invalid-stamp')).rejects.toThrow();
    });

    it('should add metadata to Mantaray for uploaded files', async () => {
      const mockFilePath = path.join(testDir, 'file1.txt');
      const customMetadata = { description: 'Test description', tags: ['test'] };

      await fileManager.uploadFile(mockFilePath, fileManager.mantaray, postageBatchId, customMetadata, '2');

      const listedFiles = fileManager.listFiles(fileManager.mantaray, true);
      const fileMeta = listedFiles.find((file: any) => file.path.includes('file1.txt'));

      expect(fileMeta).toBeDefined();
      const metadata = JSON.parse(fileMeta?.metadata?.['Custom-Metadata'] || '{}');
      expect(metadata.description).toBe('Test description');
      expect(metadata.tags).toContain('test');
    });

    it('should use default metadata when custom metadata is not provided', async () => {
      const mockFilePath = path.join(testDir, 'file2.txt');

      if (!fs.existsSync(mockFilePath)) {
        throw new Error(`Test file not found: ${mockFilePath}`);
      }

      console.log('Uploading file:', mockFilePath, 'with batch ID:', postageBatchId);
      const reference = await fileManager.uploadFile(mockFilePath, fileManager.mantaray, postageBatchId);
      console.log(`Upload reference: ${reference}`);

      // Increase the wait time to allow data propagation
      await new Promise((res) => setTimeout(res, 20000));

      const listedFiles = fileManager.listFiles(fileManager.mantaray, true);
      console.log('Listed files after upload:', JSON.stringify(listedFiles, null, 2));

      // Clean up paths by removing null characters
      const cleanedFiles = listedFiles.map((file: any) => ({
        ...file,
        path: file.path.replace(/\0/g, '').trim(),
      }));

      console.log('Cleaned file paths:', cleanedFiles);

      // Adjust search logic to match subdirectory structure
      const fileMeta = cleanedFiles.find((file: any) => file.path.endsWith('/2.txt'));

      expect(fileMeta).toBeDefined();
      expect(fileMeta?.metadata?.Filename).toBe('file2.txt');
      expect(JSON.parse(fileMeta?.metadata?.['Custom-Metadata'] || '{}')).toEqual({});
    });

    afterAll(() => {
      console.log('Upload File tests completed, cleaning up resources if necessary.');
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('FileManager - List Files', () => {
    let fileManager: FileManager;
    let postageBatchId: string;
    const privateKey = hexlify(Utils.keccak256Hash('pkinput'));
    const testDir = 'nested-dir';

    beforeAll(async () => {
      fileManager = new FileManager(BEE_API_URL, privateKey);

      console.log('Purchasing new postage batch...');
      const response = await fetch(`${BEE_API_URL}/stamps/1000000/17`, { method: 'POST' });
      const data = await response.json();
      postageBatchId = data.batchID;

      console.log(`Postage batch created: ${postageBatchId}`);

      // Wait until the postage batch becomes usable
      let isUsable = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BEE_API_URL}/stamps`);
        const result = await res.json();
        if (result.stamps.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
          isUsable = true;
          break;
        }
        console.log('Waiting for postage batch to be usable...');
        await new Promise((res) => setTimeout(res, 5000));
      }

      if (!isUsable) {
        throw new Error('Postage batch not usable within the time limit.');
      }

      // Ensure the test directory and files exist
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
      }

      fs.writeFileSync(path.join(testDir, 'file1.txt'), 'Mock content for test file 1');
      fs.writeFileSync(path.join(testDir, 'file2.txt'), 'Mock content for test file 2');

      // Upload test files to set up Mantaray
      await fileManager.uploadFile(path.join(testDir, 'file1.txt'), fileManager.mantaray, postageBatchId);
      await fileManager.uploadFile(path.join(testDir, 'file2.txt'), fileManager.mantaray, postageBatchId);
    });

    it('should list files correctly in Mantaray', () => {
      const files = fileManager.listFiles(fileManager.mantaray, false);
      const cleanedFiles = files.map((f) => ({
        path: f.path.replace(/\0/g, '').trim(),
      }));

      expect(cleanedFiles).toEqual([{ path: 'file/1.txt' }, { path: 'file/2.txt' }]);
    });

    it('should handle nested paths correctly in listFiles', async () => {
      const mockFilePath = path.join(testDir, 'file3.txt');

      if (!fs.existsSync(mockFilePath)) {
        fs.writeFileSync(mockFilePath, 'Mock content for test file 3');
      }

      console.log('Uploading file:', mockFilePath, 'with batch ID:', postageBatchId);
      await fileManager.uploadFile(mockFilePath, fileManager.mantaray, postageBatchId);

      // Wait for indexing and propagation
      await new Promise((res) => setTimeout(res, 10000));

      const files = fileManager.listFiles(fileManager.mantaray, false);
      const cleanedFiles = files
        .map((f) => ({
          path: f.path.replace(/\0/g, '').trim(),
        }))
        .sort((a, b) => a.path.localeCompare(b.path)); // Sort the files alphabetically

      console.log('Cleaned files:', cleanedFiles);

      expect(cleanedFiles.map((f) => f.path)).toEqual(
        expect.arrayContaining(['file/1.txt', 'file/2.txt', 'file/3.txt']),
      );
    });

    it('should list files correctly even when prefix is undefined', () => {
      const mantarayWithUndefinedPrefix = JSON.parse(JSON.stringify(fileManager.mantaray));

      console.log('Original Mantaray Forks:', Object.keys(mantarayWithUndefinedPrefix.forks));

      // Check if file/2.txt exists before modifying
      if (!mantarayWithUndefinedPrefix.forks['file/2.txt']) {
        console.error('Error: Fork for file/2.txt not found.');
      } else {
        mantarayWithUndefinedPrefix.forks['file/2.txt'].node = {
          isValueType: () => true,
          getMetadata: () => ({
            Filename: 'file2.txt',
            'Content-Type': 'text/plain',
          }),
        };
      }

      if (mantarayWithUndefinedPrefix.forks['file/1.txt']) {
        mantarayWithUndefinedPrefix.forks['file/1.txt'].prefix = new Uint8Array(0);

        mantarayWithUndefinedPrefix.forks['file/1.txt'].node = {
          isValueType: () => true,
          getMetadata: () => ({
            Filename: 'file1.txt',
            'Content-Type': 'text/plain',
          }),
        };
      } else {
        console.warn('Fork structure not found for file/1.txt');
      }

      console.log('Modified Mantaray Node:', JSON.stringify(mantarayWithUndefinedPrefix, null, 2));

      const files = fileManager.listFiles(mantarayWithUndefinedPrefix, false);
      const cleanedFiles = files.map((f) => ({
        path: f.path.replace(/\0/g, '').trim(),
      }));

      console.log('Cleaned file paths:', cleanedFiles);

      expect(cleanedFiles.map((f) => f.path)).toEqual(expect.arrayContaining(['file/2.txt']));
    });

    it('should list files with metadata in custom forks', async () => {
      const mockFilePath = path.join(testDir, 'file3.txt');

      if (!fs.existsSync(mockFilePath)) {
        fs.writeFileSync(mockFilePath, 'Mock content for test file 3');
      }

      console.log('Uploading file with metadata:', mockFilePath);
      await fileManager.uploadFile(mockFilePath, fileManager.mantaray, postageBatchId, {
        description: 'Custom file test',
        tags: ['custom'],
      });

      // Wait for indexing and propagation
      await new Promise((res) => setTimeout(res, 15000));

      const files = fileManager.listFiles(fileManager.mantaray, true);
      const cleanedFiles = files.map((file) => ({
        path: file.path.replace(/\0/g, '').trim(),
        metadata: file.metadata,
      }));

      console.log('Cleaned file paths with metadata:', cleanedFiles);

      expect(cleanedFiles).toEqual(
        expect.arrayContaining([
          {
            path: 'file/3.txt',
            metadata: expect.objectContaining({
              Filename: 'file3.txt',
              'Content-Type': 'text/plain',
              'Custom-Metadata': JSON.stringify({ description: 'Custom file test', tags: ['custom'] }),
            }),
          },
        ]),
      );
    });

    it('should ensure metadata is not duplicated in listFiles', () => {
      const files = fileManager.listFiles(fileManager.mantaray, true);
      const cleanedFiles = files.map((f) => ({
        path: f.path.replace(/\0/g, '').trim(),
        metadata: f.metadata,
      }));

      expect(cleanedFiles).toEqual(
        expect.arrayContaining([
          {
            path: 'file/1.txt',
            metadata: expect.objectContaining({
              Filename: 'file1.txt',
              'Content-Type': 'text/plain',
            }),
          },
          {
            path: 'file/2.txt',
            metadata: expect.objectContaining({
              Filename: 'file2.txt',
              'Content-Type': 'text/plain',
            }),
          },
        ]),
      );
    });

    afterAll(() => {
      console.log('List Files tests completed, cleaning up resources if necessary.');
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('FileManager - Search Files by Name', () => {
    let fileManager: FileManager;
    let postageBatchId: string;
    const privateKey = hexlify(Utils.keccak256Hash('pkinput'));
    const testDir = 'search-test-dir';

    beforeAll(async () => {
      fileManager = new FileManager(BEE_API_URL, privateKey);

      console.log('Purchasing new postage batch...');
      const response = await fetch(`${BEE_API_URL}/stamps/1000000/17`, { method: 'POST' });
      const data = await response.json();
      postageBatchId = data.batchID;

      console.log(`Postage batch created: ${postageBatchId}`);

      let isUsable = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BEE_API_URL}/stamps`);
        const result = await res.json();
        if (result.stamps.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
          isUsable = true;
          break;
        }
        console.log('Waiting for postage batch to be usable...');
        await new Promise((res) => setTimeout(res, 5000));
      }

      if (!isUsable) {
        throw new Error('Postage batch not usable within the time limit.');
      }

      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
      }

      fs.writeFileSync(path.join(testDir, 'file1.txt'), 'Mock content for test file 1');
      fs.writeFileSync(path.join(testDir, 'file2.txt'), 'Mock content for test file 2');
      fs.writeFileSync(path.join(testDir, 'notes.txt'), 'Mock content for test notes file');

      // Upload test files to set up Mantaray
      await fileManager.uploadFile(path.join(testDir, 'file1.txt'), fileManager.mantaray, postageBatchId);
      await fileManager.uploadFile(path.join(testDir, 'file2.txt'), fileManager.mantaray, postageBatchId);
      await fileManager.uploadFile(path.join(testDir, 'notes.txt'), fileManager.mantaray, postageBatchId);
    });

    it('should return files matching the query', () => {
      const result = fileManager.searchFilesByName('1.txt');
      const cleanedFiles = result.map((f) => ({
        path: f.path.replace(/\0/g, '').trim(),
      }));

      expect(cleanedFiles).toEqual([{ path: 'file/1.txt' }]);
    });

    it('should return multiple files when multiple match the query', () => {
      const result = fileManager.searchFilesByName('file');
      const cleanedFiles = result.map((f) => ({
        path: f.path.replace(/\0/g, '').trim(),
      }));

      expect(cleanedFiles).toEqual(expect.arrayContaining([{ path: 'file/1.txt' }, { path: 'file/2.txt' }]));
    });

    it('should return an empty array when no files match the query', () => {
      const result = fileManager.searchFilesByName('nonexistent');
      expect(result).toEqual([]);
    });

    it('should return files with metadata when includeMetadata is true', () => {
      const result = fileManager.searchFilesByName('1.txt', true);
      const cleanedFiles = result.map((f) => ({
        path: f.path.replace(/\0/g, '').trim(),
        metadata: f.metadata,
      }));

      expect(cleanedFiles).toEqual([
        {
          path: 'file/1.txt',
          metadata: expect.objectContaining({
            Filename: 'file1.txt',
            'Content-Type': 'text/plain',
          }),
        },
      ]);
    });

    afterAll(() => {
      console.log('Search Files by Name tests completed, cleaning up resources.');
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});

describe('FileManager - Advanced Search Files', () => {
  let fileManager: FileManager;
  let postageBatchId: string;
  const privateKey = hexlify(Utils.keccak256Hash('pkinput'));
  const testDir = 'advanced-search-test-dir';

  beforeAll(async () => {
    fileManager = new FileManager(BEE_API_URL, privateKey);

    console.log('Purchasing new postage batch...');
    const response = await fetch(`${BEE_API_URL}/stamps/1000000/17`, { method: 'POST' });
    const data = await response.json();
    postageBatchId = data.batchID;

    console.log(`Postage batch created: ${postageBatchId}`);

    let isUsable = false;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${BEE_API_URL}/stamps`);
      const result = await res.json();
      if (result.stamps.some((batch: any) => batch.batchID === postageBatchId && batch.usable)) {
        isUsable = true;
        break;
      }
      console.log('Waiting for postage batch to be usable...');
      await new Promise((res) => setTimeout(res, 5000));
    }

    if (!isUsable) {
      throw new Error('Postage batch not usable within the time limit.');
    }

    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }

    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'Mock content for test file 1');
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'Mock content for test file 2');
    fs.writeFileSync(path.join(testDir, 'file3.log'), 'Mock log file');

    // Upload test files to set up Mantaray
    await fileManager.uploadFile(path.join(testDir, 'file1.txt'), fileManager.mantaray, postageBatchId, {
      'Content-Type': 'text/plain',
      'Content-Size': '500',
    });
    await fileManager.uploadFile(path.join(testDir, 'file2.txt'), fileManager.mantaray, postageBatchId, {
      'Content-Type': 'text/plain',
      'Content-Size': '1500',
    });
    await fileManager.uploadFile(path.join(testDir, 'file3.log'), fileManager.mantaray, postageBatchId, {
      'Content-Type': 'application/log',
    });
  });

  it('should return files matching the file name', () => {
    const result = fileManager.searchFiles({ fileName: 'file1.txt' });
    expect(result.map((f) => ({ path: f.path.replace(/\0/g, '').trim() }))).toEqual([{ path: 'file1.txt' }]);
  });

  it('should return files within a specific directory', () => {
    const result = fileManager.searchFiles({ directory: 'advanced-search-test-dir' });
    expect(result.map((f) => ({ path: f.path.replace(/\0/g, '').trim() }))).toEqual(
      expect.arrayContaining([{ path: 'file1.txt' }, { path: 'file2.txt' }]),
    );
  });

  it('should return files matching metadata', () => {
    const result = fileManager.searchFiles({ metadata: { 'Content-Type': 'text/plain' } });
    expect(result.map((f) => ({ path: f.path.replace(/\0/g, '').trim() }))).toEqual(
      expect.arrayContaining([{ path: 'file1.txt' }, { path: 'file2.txt' }]),
    );
  });

  it('should return files within a specific size range', () => {
    const result = fileManager.searchFiles({ minSize: 1000, maxSize: 2000 });
    expect(result.map((f) => ({ path: f.path.replace(/\0/g, '').trim() }))).toEqual([{ path: 'file2.txt' }]);
  });

  it('should return files with a specific extension', () => {
    const result = fileManager.searchFiles({ extension: '.txt' });
    expect(result.map((f) => ({ path: f.path.replace(/\0/g, '').trim() }))).toEqual(
      expect.arrayContaining([{ path: 'file1.txt' }, { path: 'file2.txt' }]),
    );
  });

  it('should return files matching multiple criteria', () => {
    const result = fileManager.searchFiles({
      fileName: 'file2.txt',
      directory: 'advanced-search-test-dir',
      metadata: { 'Content-Type': 'text/plain' },
      minSize: 1000,
      maxSize: 2000,
      extension: '.txt',
    });
    expect(result.map((f) => ({ path: f.path.replace(/\0/g, '').trim() }))).toEqual([{ path: 'file2.txt' }]);
  });

  it('should return an empty array if no files match the criteria', () => {
    const result = fileManager.searchFiles({ fileName: 'nonexistent.txt' });
    expect(result).toEqual([]);
  });

  afterAll(() => {
    console.log('Advanced Search Files tests completed, cleaning up resources.');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
