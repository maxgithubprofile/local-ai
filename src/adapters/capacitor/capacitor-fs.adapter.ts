import type { FileSystemPort } from '../../core/ports/filesystem.port.js';

/**
 * Not implemented — Phase 1/2 (ROADMAP.md). Wraps `@capacitor/filesystem`
 * (TZ §4.3).
 */
export class CapacitorFsAdapter implements FileSystemPort {
  async exists(_path: string): Promise<boolean> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  async writeFile(_path: string, _data: Uint8Array | string): Promise<void> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  async readFile(_path: string): Promise<Uint8Array> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  async *readChunks(_path: string, _chunkSizeBytes: number): AsyncIterable<Uint8Array> {
    throw new Error('not implemented — see TZ §4.3, §7.4, ROADMAP Phase 1/2');
  }

  async deleteFile(_path: string): Promise<void> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  async listFiles(_dirPath: string): Promise<string[]> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  async stat(_path: string): Promise<{ sizeBytes: number } | null> {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }

  resolvePath(..._segments: string[]): string {
    throw new Error('not implemented — see TZ §4.3, ROADMAP Phase 1/2');
  }
}
