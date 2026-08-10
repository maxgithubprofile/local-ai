import type { FileSystemPort } from '../ports/filesystem.port.js';
import type { HashPort } from '../ports/hash.port.js';

/** Default chunk size for streaming reads — 8 MiB, small enough to keep memory flat on a phone. */
export const DEFAULT_CHECKSUM_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Streams `path` through `HashPort.createSha256()` in chunks (TZ §7.4)
 * rather than reading it fully into memory — the artifacts here are
 * GB-scale GGUF files. `onProgress`, if given, is called after every chunk
 * with bytes hashed so far — the incremental-progress UI decision from
 * `docs/adr/0006-streaming-sha256-timing.md`.
 */
export async function verifyChecksum(
  path: string,
  expectedSha256: string,
  ports: { fileSystem: FileSystemPort; hash: HashPort },
  options?: { chunkSizeBytes?: number; onProgress?: (bytesHashed: number) => void },
): Promise<boolean> {
  const hasher = ports.hash.createSha256();
  let bytesHashed = 0;

  for await (const chunk of ports.fileSystem.readChunks(path, options?.chunkSizeBytes ?? DEFAULT_CHECKSUM_CHUNK_BYTES)) {
    hasher.update(chunk);
    bytesHashed += chunk.length;
    options?.onProgress?.(bytesHashed);
  }

  const actual = hasher.digestHex();
  return actual.toLowerCase() === expectedSha256.toLowerCase();
}
