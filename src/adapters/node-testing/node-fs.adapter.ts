import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileSystemPort } from '../../core/ports/filesystem.port.js';

/**
 * `node:fs/promises` implementation of {@link FileSystemPort}, rooted at a
 * fixed directory on disk — used by `DownloadEngine`/`ModelRegistry`
 * integration tests, TZ §13.1. `resolvePath()` joins segments under that
 * root; every other method expects a path this adapter itself produced
 * (via `resolvePath()`) or an equivalent absolute path — it does not
 * sandbox against traversal outside the root, matching the production
 * `CapacitorFsAdapter`'s trust model (paths come from `local-ai`'s own
 * code, never directly from untrusted input).
 */
export class NodeFsAdapter implements FileSystemPort {
  constructor(private readonly root: string) {}

  resolvePath(...segments: string[]): string {
    return path.join(this.root, ...segments);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, { recursive: options?.recursive ?? false });
  }

  async writeFile(filePath: string, data: Uint8Array | string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async appendFile(filePath: string, data: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, data);
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(filePath));
  }

  async *readChunks(filePath: string, chunkSizeBytes: number): AsyncIterable<Uint8Array> {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(chunkSizeBytes);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, chunkSizeBytes, null);
        if (bytesRead === 0) break;
        yield new Uint8Array(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  }

  async listFiles(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async stat(filePath: string): Promise<{ sizeBytes: number } | null> {
    try {
      const s = await fs.stat(filePath);
      return { sizeBytes: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * `fs.promises.statfs()` (Node >=18.15, this package requires >=22.5 per
   * `package.json`'s `engines`) reports the volume backing the nearest
   * existing ancestor of `filePath` — `filePath` itself need not exist yet,
   * which is exactly the case `DownloadEngine` calls this in (SEC.3).
   */
  async freeSpaceBytes(filePath: string): Promise<number> {
    let target = filePath;
    for (;;) {
      try {
        const s = await fs.statfs(target);
        return s.bavail * s.bsize;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const parent = path.dirname(target);
        if (parent === target) throw err; // reached the filesystem root and it's still missing
        target = parent;
      }
    }
  }
}
