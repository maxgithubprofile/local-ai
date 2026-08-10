import type { SqlitePort, SqliteRow } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import { BaseVectorStore } from './vector-store-base.js';
import type { VectorEntry, VectorSearchHit, VectorSpaceDescriptor } from './vector-store.js';

interface VectorEntryRow extends SqliteRow {
  id: string;
  embedding: Uint8Array;
  text: string | null;
  metadata: string | null;
}

function float32ToBlob(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function blobToFloat32(blob: Uint8Array): Float32Array {
  // Copy into a fresh, aligned buffer — `blob` may be a view into a larger
  // buffer at a non-4-byte-aligned offset (driver-dependent), which
  // `Float32Array`'s constructor requires.
  const copy = blob.slice().buffer;
  return new Float32Array(copy);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesFilter(metadata: Record<string, unknown> | undefined, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

/**
 * Brute-force `VectorStore` fallback (TZ §8.3) — cosine similarity computed
 * in TS over `vector_entries`' `BLOB` column. Ships unconditionally
 * (`ROADMAP.md` task 3.6), not only when sqlite-vec fails — see
 * `create-vector-store.ts`. `O(n)` per search, entirely adequate for a
 * single user's local chat/knowledge corpus (hundreds to low thousands of
 * entries, not a server-scale index).
 */
export class BruteForceVectorStore extends BaseVectorStore {
  constructor(sqlite: SqlitePort, clock: ClockPort) {
    super(sqlite, clock);
  }

  protected async createVectorTable(_space: VectorSpaceDescriptor): Promise<void> {
    // vector_entries is dimension-agnostic (BLOB) — created once by
    // migration 002, nothing further needed per-space.
  }

  protected async doUpsert(entry: VectorEntry): Promise<void> {
    await this.sqlite.execute(
      `INSERT INTO vector_entries (id, embedding, text, metadata) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding, text = excluded.text, metadata = excluded.metadata`,
      [entry.id, float32ToBlob(entry.embedding), entry.text ?? null, entry.metadata ? JSON.stringify(entry.metadata) : null],
    );
  }

  protected async doSearch(
    queryEmbedding: Float32Array,
    options?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchHit[]> {
    const rows = await this.sqlite.query<VectorEntryRow>('SELECT * FROM vector_entries');
    const topK = options?.topK ?? 10;

    const scored = rows
      .map((row) => {
        const metadata = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined;
        return { row, metadata, score: cosineSimilarity(queryEmbedding, blobToFloat32(row.embedding)) };
      })
      .filter(({ metadata }) => matchesFilter(metadata, options?.filter))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map(({ row, metadata, score }) => ({
      id: row.id,
      score,
      text: row.text ?? undefined,
      metadata,
    }));
  }

  protected async doDelete(id: string): Promise<void> {
    await this.sqlite.execute('DELETE FROM vector_entries WHERE id = ?', [id]);
  }

  protected async doCount(): Promise<number> {
    const rows = await this.sqlite.query<{ n: number }>('SELECT COUNT(*) as n FROM vector_entries');
    return rows[0]?.n ?? 0;
  }

  protected async doWipe(): Promise<void> {
    await this.sqlite.execute('DELETE FROM vector_entries');
  }
}
