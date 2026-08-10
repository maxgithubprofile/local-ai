import type { SqlitePort, SqliteRow } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import { VectorSpaceMismatchError } from '../errors.js';
import type { VectorEntry, VectorSearchHit, VectorSpaceDescriptor, VectorStore } from './vector-store.js';

interface VectorSpaceRow extends SqliteRow {
  embedding_id: string;
  embedding_version: number;
  dimensions: number;
}

function spacesEqual(a: VectorSpaceDescriptor, b: VectorSpaceDescriptor): boolean {
  return a.embeddingId === b.embeddingId && a.embeddingVersion === b.embeddingVersion && a.dimensions === b.dimensions;
}

/**
 * Shared `vector_space` guard bookkeeping (TZ §8.2/§8.3) — every
 * `VectorStore` implementation (sqlite-vec primary path, brute-force
 * fallback) subclasses this so the guard logic exists exactly once. The
 * storage-format-specific parts (schema DDL, actual upsert/search/delete)
 * are subclass responsibilities via the protected `do*` methods.
 */
export abstract class BaseVectorStore implements VectorStore {
  constructor(
    protected readonly sqlite: SqlitePort,
    protected readonly clock: ClockPort,
  ) {}

  async currentSpace(): Promise<VectorSpaceDescriptor | null> {
    const rows = await this.sqlite.query<VectorSpaceRow>('SELECT * FROM vector_space WHERE id = 1');
    const row = rows[0];
    if (!row) return null;
    return { embeddingId: row.embedding_id, embeddingVersion: row.embedding_version, dimensions: row.dimensions };
  }

  async ensureSchema(space: VectorSpaceDescriptor): Promise<void> {
    await this.createVectorTable(space);
    const current = await this.currentSpace();
    if (current && !spacesEqual(current, space)) {
      const existingCount = await this.doCount();
      if (existingCount > 0) {
        throw new VectorSpaceMismatchError(
          `vector_space is currently ${JSON.stringify(current)} with ${existingCount} vector(s) stored, ` +
            `but ensureSchema() was called with ${JSON.stringify(space)} — call reindex() to switch spaces deliberately`,
        );
      }
    }
    await this.writeSpace(space);
  }

  async upsert(entry: VectorEntry, space: VectorSpaceDescriptor): Promise<void> {
    await this.assertSpace(space);
    this.assertDimensions(entry.embedding, space);
    await this.doUpsert(entry);
  }

  async upsertMany(entries: VectorEntry[], space: VectorSpaceDescriptor): Promise<void> {
    await this.assertSpace(space);
    for (const entry of entries) this.assertDimensions(entry.embedding, space);
    for (const entry of entries) await this.doUpsert(entry);
  }

  async search(
    queryEmbedding: Float32Array,
    space: VectorSpaceDescriptor,
    options?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchHit[]> {
    await this.assertSpace(space);
    this.assertDimensions(queryEmbedding, space);
    return this.doSearch(queryEmbedding, options);
  }

  async delete(id: string): Promise<void> {
    await this.doDelete(id);
  }

  async count(): Promise<number> {
    return this.doCount();
  }

  async reindex(newSpace: VectorSpaceDescriptor): Promise<void> {
    await this.createVectorTable(newSpace);
    await this.doWipe();
    await this.writeSpace(newSpace);
  }

  private async assertSpace(space: VectorSpaceDescriptor): Promise<void> {
    const current = await this.currentSpace();
    if (!current || !spacesEqual(current, space)) {
      throw new VectorSpaceMismatchError(
        `expected the active vector_space to be ${JSON.stringify(space)}, but it is ${JSON.stringify(current)} — call reindex() to switch spaces deliberately`,
      );
    }
  }

  private assertDimensions(embedding: Float32Array, space: VectorSpaceDescriptor): void {
    if (embedding.length !== space.dimensions) {
      throw new VectorSpaceMismatchError(
        `embedding has ${embedding.length} dimensions but the active vector_space declares ${space.dimensions}`,
      );
    }
  }

  private async writeSpace(space: VectorSpaceDescriptor): Promise<void> {
    await this.sqlite.execute(
      `INSERT INTO vector_space (id, embedding_id, embedding_version, dimensions, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         embedding_id = excluded.embedding_id,
         embedding_version = excluded.embedding_version,
         dimensions = excluded.dimensions,
         updated_at = excluded.updated_at`,
      [space.embeddingId, space.embeddingVersion, space.dimensions, this.clock.nowIso()],
    );
  }

  protected abstract createVectorTable(space: VectorSpaceDescriptor): Promise<void>;
  protected abstract doUpsert(entry: VectorEntry): Promise<void>;
  protected abstract doSearch(
    queryEmbedding: Float32Array,
    options?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchHit[]>;
  protected abstract doDelete(id: string): Promise<void>;
  protected abstract doCount(): Promise<number>;
  protected abstract doWipe(): Promise<void>;
}
