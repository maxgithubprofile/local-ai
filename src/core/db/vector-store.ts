/**
 * Vector storage contract — TZ §8.2. The interface is identical across the
 * `sqlite-vec` primary path and the brute-force TS fallback (TZ §8.3); both
 * are covered by the same contract-test suite (TZ §13.3).
 *
 * The core guarantee this interface encodes: `vector-store:embedding-changed`
 * (TZ §5.6) is a useful early signal but is **not** the only line of
 * defense against silently searching a stale embedding space. `VectorStore`
 * itself tracks which embedding space is actually written (`vector_space`
 * table, TZ §8.1) and every read/write is checked against it —
 * mismatched `(embeddingId, embeddingVersion, dimensions)` throws
 * `VectorSpaceMismatchError` instead of returning a technically-valid,
 * semantically-wrong result.
 */
export interface VectorSpaceDescriptor {
  embeddingId: string;
  embeddingVersion: number;
  dimensions: number;
}

export interface VectorEntry {
  id: string;
  embedding: Float32Array;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchHit {
  id: string;
  score: number;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  /**
   * Initializes schema for the given space. If `vector_space` already
   * records a *different* space and rows exist, throws
   * `VectorSpaceMismatchError` instead of silently re-initializing — the
   * caller must consciously choose `reindex()` or keep working with the old
   * space.
   */
  ensureSchema(space: VectorSpaceDescriptor): Promise<void>;

  /**
   * `space` must strictly equal what's recorded in `vector_space` —
   * `embeddingId` + `embeddingVersion` + `dimensions` all match, not just
   * dimensions (TZ §5.6: a different embedder version isn't guaranteed to
   * share a vector space even at equal `dimensions`). Mismatch throws
   * `VectorSpaceMismatchError` and performs no write.
   */
  upsert(entry: VectorEntry, space: VectorSpaceDescriptor): Promise<void>;
  upsertMany(entries: VectorEntry[], space: VectorSpaceDescriptor): Promise<void>;
  search(
    queryEmbedding: Float32Array,
    space: VectorSpaceDescriptor,
    options?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchHit[]>;

  delete(id: string): Promise<void>;
  /** Wipes all vectors and adopts `newSpace` as current — the only sanctioned way to switch spaces. */
  reindex(newSpace: VectorSpaceDescriptor): Promise<void>;
  count(): Promise<number>;
  currentSpace(): Promise<VectorSpaceDescriptor | null>;
}
