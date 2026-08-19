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
  /**
   * Appends `data` to `path`, creating it (and any parent directories) if it
   * doesn't exist yet. Added for `CapacitorRangeDownloadAdapter` (TZ §7.2 /
   * `docs/adr/0003-capgo-capacitor-downloader.md`'s real-device findings) —
   * chunked `Range:` downloads write incrementally rather than holding the
   * whole artifact in memory before one `writeFile()` call.
   */
  appendFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  /** Chunked read so large GGUF files never need to be fully memory-resident (TZ §7.4). */
  readChunks(path: string, chunkSizeBytes: number): AsyncIterable<Uint8Array>;
  deleteFile(path: string): Promise<void>;
  listFiles(dirPath: string): Promise<string[]>;
  stat(path: string): Promise<{ sizeBytes: number } | null>;
  /** Joins segments under the library's storage root (`LocalAiConfig.storageDirectory`, TZ §10). */
  resolvePath(...segments: string[]): string;
  /**
   * Bytes free on the volume backing `path` (SEC.3,
   * `docs/decisions.md`'s "Security audit (2026-08-11)" section) —
   * `DownloadEngine.downloadArtifact()` checks this against
   * `artifact.sizeBytes * 1.15` immediately before every download attempt
   * and throws `InsufficientStorageError` rather than writing, independent
   * of whatever `eligibilityPolicy` the caller configured (that policy gates
   * `EligibilityService`'s point-in-time snapshot, not this per-write check).
   */
  freeSpaceBytes(path: string): Promise<number>;
}
