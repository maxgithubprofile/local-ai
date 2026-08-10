/**
 * Incremental hasher for streaming a large file through SHA-256 without
 * holding it fully in memory — TZ §7.4 (chunked read + `.create().update(chunk)`
 * style API, e.g. `@noble/hashes/sha256` on the production side).
 */
export interface IncrementalHasher {
  update(chunk: Uint8Array): void;
  /** Lowercase hex digest — same format as `ModelArtifact.sha256`/`EmbeddingArtifact.sha256`. */
  digestHex(): string;
}

/** Hashing port used for downloaded-artifact integrity checks — TZ §7.4, §14. */
export interface HashPort {
  /** One-shot hash for small in-memory buffers. */
  sha256(data: Uint8Array): string;
  /** Streaming hash for GB-scale GGUF files — see {@link IncrementalHasher}. */
  createSha256(): IncrementalHasher;
}
