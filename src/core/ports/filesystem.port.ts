/**
 * File storage port — TZ §4.3: download destinations, deleting stale
 * artifact versions, orphan cleanup, and chunked reads for the streaming
 * SHA-256 in `checksum.ts` (TZ §7.4). Production adapter wraps
 * `@capacitor/filesystem`; the Node adapter wraps `node:fs` for tests.
 */
export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  /** Chunked read so large GGUF files never need to be fully memory-resident (TZ §7.4). */
  readChunks(path: string, chunkSizeBytes: number): AsyncIterable<Uint8Array>;
  deleteFile(path: string): Promise<void>;
  listFiles(dirPath: string): Promise<string[]>;
  stat(path: string): Promise<{ sizeBytes: number } | null>;
  /** Joins segments under the library's storage root (`LocalAiConfig.storageDirectory`, TZ §10). */
  resolvePath(...segments: string[]): string;
}
