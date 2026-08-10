import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyChecksum } from '../../../src/core/download/checksum.js';
import { WebCryptoHashAdapter } from '../../../src/adapters/node-testing/web-crypto-hash.adapter.js';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';

describe('WebCryptoHashAdapter', () => {
  it('sha256() matches the well-known empty-string digest', () => {
    const hash = new WebCryptoHashAdapter();
    expect(hash.sha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('createSha256() incremental digest matches a one-shot digest of the same bytes', () => {
    const hash = new WebCryptoHashAdapter();
    const data = new TextEncoder().encode('hello world, this is local-ai');
    const oneShot = hash.sha256(data);

    const incremental = hash.createSha256();
    incremental.update(data.subarray(0, 10));
    incremental.update(data.subarray(10));
    expect(incremental.digestHex()).toBe(oneShot);
  });
});

describe('verifyChecksum', () => {
  let tmpDir: string;

  it('returns true when the file matches the expected sha256, using tiny chunks', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-checksum-'));
    try {
      const fileSystem = new NodeFsAdapter(tmpDir);
      const hash = new WebCryptoHashAdapter();
      const content = new TextEncoder().encode('x'.repeat(5000));
      const filePath = fileSystem.resolvePath('artifact.bin');
      await fileSystem.writeFile(filePath, content);

      const expected = hash.sha256(content);
      const progressCalls: number[] = [];
      const ok = await verifyChecksum(filePath, expected, { fileSystem, hash }, {
        chunkSizeBytes: 64,
        onProgress: (n) => progressCalls.push(n),
      });

      expect(ok).toBe(true);
      expect(progressCalls.length).toBeGreaterThan(1); // several 64-byte chunks
      expect(progressCalls[progressCalls.length - 1]).toBe(content.length);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns false when the file does not match the expected sha256', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-checksum-'));
    try {
      const fileSystem = new NodeFsAdapter(tmpDir);
      const hash = new WebCryptoHashAdapter();
      const filePath = fileSystem.resolvePath('artifact.bin');
      await fileSystem.writeFile(filePath, new TextEncoder().encode('actual content'));

      const ok = await verifyChecksum(filePath, 'f'.repeat(64), { fileSystem, hash });
      expect(ok).toBe(false);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('is case-insensitive when comparing hex digests', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-checksum-'));
    try {
      const fileSystem = new NodeFsAdapter(tmpDir);
      const hash = new WebCryptoHashAdapter();
      const content = new TextEncoder().encode('case insensitivity check');
      const filePath = fileSystem.resolvePath('artifact.bin');
      await fileSystem.writeFile(filePath, content);

      const expected = hash.sha256(content).toUpperCase();
      const ok = await verifyChecksum(filePath, expected, { fileSystem, hash });
      expect(ok).toBe(true);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
