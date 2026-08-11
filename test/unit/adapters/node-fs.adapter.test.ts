import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';

describe('NodeFsAdapter', () => {
  let tmpDir: string;
  let adapter: NodeFsAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-node-fs-'));
    adapter = new NodeFsAdapter(tmpDir);
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolvePath() joins segments under the root', () => {
    expect(adapter.resolvePath('models', 'a.gguf')).toBe(path.join(tmpDir, 'models', 'a.gguf'));
  });

  it('exists() is false for a missing file and true after writeFile()', async () => {
    const p = adapter.resolvePath('a.txt');
    expect(await adapter.exists(p)).toBe(false);
    await adapter.writeFile(p, 'hello');
    expect(await adapter.exists(p)).toBe(true);
  });

  it('writeFile() creates missing parent directories', async () => {
    const p = adapter.resolvePath('nested', 'deep', 'a.txt');
    await adapter.writeFile(p, 'hi');
    expect(await adapter.readFile(p)).toEqual(new TextEncoder().encode('hi'));
  });

  it('readChunks() yields the file in order and reconstructs exactly', async () => {
    const p = adapter.resolvePath('big.bin');
    const content = new Uint8Array(1000).map((_, i) => i % 256);
    await adapter.writeFile(p, content);

    const collected: number[] = [];
    for await (const chunk of adapter.readChunks(p, 37)) {
      collected.push(...chunk);
    }
    expect(new Uint8Array(collected)).toEqual(content);
  });

  it('deleteFile() removes the file; is a no-op on a missing file', async () => {
    const p = adapter.resolvePath('a.txt');
    await adapter.writeFile(p, 'x');
    await adapter.deleteFile(p);
    expect(await adapter.exists(p)).toBe(false);
    await expect(adapter.deleteFile(p)).resolves.toBeUndefined();
  });

  it('listFiles() lists directory contents; empty array for a missing directory', async () => {
    await adapter.writeFile(adapter.resolvePath('dir', 'a.txt'), 'a');
    await adapter.writeFile(adapter.resolvePath('dir', 'b.txt'), 'b');
    const files = await adapter.listFiles(adapter.resolvePath('dir'));
    expect(files.sort()).toEqual(['a.txt', 'b.txt']);
    expect(await adapter.listFiles(adapter.resolvePath('missing'))).toEqual([]);
  });

  it('stat() returns sizeBytes for an existing file, null for a missing one', async () => {
    const p = adapter.resolvePath('a.txt');
    await adapter.writeFile(p, 'hello');
    expect(await adapter.stat(p)).toEqual({ sizeBytes: 5 });
    expect(await adapter.stat(adapter.resolvePath('missing.txt'))).toBeNull();
  });

  it('freeSpaceBytes() returns a positive number for a path that does not exist yet', async () => {
    const free = await adapter.freeSpaceBytes(adapter.resolvePath('models', 'not-downloaded-yet.gguf'));
    expect(free).toBeGreaterThan(0);
  });

  it('freeSpaceBytes() returns a positive number for an existing file', async () => {
    const p = adapter.resolvePath('a.txt');
    await adapter.writeFile(p, 'hello');
    expect(await adapter.freeSpaceBytes(p)).toBeGreaterThan(0);
  });
});
