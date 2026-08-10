import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import { BaseVectorStore } from './vector-store-base.js';
import type { VectorEntry, VectorSearchHit, VectorSpaceDescriptor } from './vector-store.js';

function float32ToBlob(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function matchesFilter(metadata: Record<string, unknown> | undefined, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  if (!metadata) return false;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

/**
 * `sqlite-vec` (`vec0`) primary `VectorStore` path (TZ §8.2). **Unverified
 * in this environment** — `docs/adr/0002-sqlite-vec-load-extension.md` is
 * `proposed`, not `accepted` (no Android/iOS device to confirm
 * `loadExtension()` actually succeeds, or that this exact `vec0` SQL
 * syntax — `distance_metric=cosine` column option, `k = ?` KNN clause —
 * matches the bundled `sqlite-vec` version). `create-vector-store.ts` only
 * selects this class after `SqlitePort.loadVectorExtension()` itself
 * resolved `true`; any further failure (e.g. a syntax mismatch) should
 * surface loudly during that opportunistic self-test rather than silently
 * here.
 *
 * A `vec0` virtual table stores only its declared vector column(s) plus an
 * implicit integer `rowid` — it can't hold our caller-supplied string `id`,
 * `text`, or `metadata`, so those live in the companion `vector_meta` table
 * (migration 002), joined back by `rowid`. `vec0` doesn't support `UPDATE`
 * reliably, so an upsert of an existing id deletes-then-reinserts its vec0
 * row rather than updating in place.
 */
export class SqliteVecVectorStore extends BaseVectorStore {
  constructor(sqlite: SqlitePort, clock: ClockPort) {
    super(sqlite, clock);
  }

  protected async createVectorTable(space: VectorSpaceDescriptor): Promise<void> {
    await this.sqlite.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vector_vec0 USING vec0(embedding float[${space.dimensions}] distance_metric=cosine)`,
    );
  }

  protected async doUpsert(entry: VectorEntry): Promise<void> {
    const existing = await this.sqlite.query<{ rowid: number }>('SELECT rowid FROM vector_meta WHERE id = ?', [
      entry.id,
    ]);
    const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null;

    let rowid: number;
    if (existing[0]) {
      rowid = existing[0].rowid;
      await this.sqlite.execute('UPDATE vector_meta SET text = ?, metadata = ? WHERE rowid = ?', [
        entry.text ?? null,
        metadataJson,
        rowid,
      ]);
      await this.sqlite.execute('DELETE FROM vector_vec0 WHERE rowid = ?', [rowid]);
    } else {
      await this.sqlite.execute('INSERT INTO vector_meta (id, text, metadata) VALUES (?, ?, ?)', [
        entry.id,
        entry.text ?? null,
        metadataJson,
      ]);
      const inserted = await this.sqlite.query<{ rowid: number }>('SELECT rowid FROM vector_meta WHERE id = ?', [
        entry.id,
      ]);
      rowid = inserted[0]!.rowid;
    }

    await this.sqlite.execute('INSERT INTO vector_vec0(rowid, embedding) VALUES (?, ?)', [
      rowid,
      float32ToBlob(entry.embedding),
    ]);
  }

  protected async doSearch(
    queryEmbedding: Float32Array,
    options?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchHit[]> {
    const topK = options?.topK ?? 10;
    // Over-fetch when a post-hoc metadata filter is present — vec0's KNN
    // doesn't know about `vector_meta.metadata`, so filtering narrows the
    // candidate set *after* the nearest-neighbor search, same tradeoff the
    // brute-force store doesn't have to make (it filters before sorting).
    const k = options?.filter ? topK * 4 : topK;

    const matches = await this.sqlite.query<{ rowid: number; distance: number }>(
      'SELECT rowid, distance FROM vector_vec0 WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      [float32ToBlob(queryEmbedding), k],
    );
    if (matches.length === 0) return [];

    const placeholders = matches.map(() => '?').join(', ');
    const metaRows = await this.sqlite.query<{ rowid: number; id: string; text: string | null; metadata: string | null }>(
      `SELECT rowid, id, text, metadata FROM vector_meta WHERE rowid IN (${placeholders})`,
      matches.map((m) => m.rowid),
    );
    const metaByRowid = new Map(metaRows.map((m) => [m.rowid, m]));

    const hits: VectorSearchHit[] = [];
    for (const match of matches) {
      const meta = metaByRowid.get(match.rowid);
      if (!meta) continue; // orphaned vec0 row (shouldn't happen; defensive)
      const metadata = meta.metadata ? (JSON.parse(meta.metadata) as Record<string, unknown>) : undefined;
      if (!matchesFilter(metadata, options?.filter)) continue;
      // distance_metric=cosine's `distance` is `1 - cosine_similarity` —
      // converting back to similarity keeps `score` semantics identical to
      // the brute-force store's (higher is better, ~[-1, 1]).
      hits.push({ id: meta.id, score: 1 - match.distance, text: meta.text ?? undefined, metadata });
      if (hits.length >= topK) break;
    }
    return hits;
  }

  protected async doDelete(id: string): Promise<void> {
    const existing = await this.sqlite.query<{ rowid: number }>('SELECT rowid FROM vector_meta WHERE id = ?', [id]);
    const row = existing[0];
    if (!row) return;
    await this.sqlite.execute('DELETE FROM vector_vec0 WHERE rowid = ?', [row.rowid]);
    await this.sqlite.execute('DELETE FROM vector_meta WHERE rowid = ?', [row.rowid]);
  }

  protected async doCount(): Promise<number> {
    const rows = await this.sqlite.query<{ n: number }>('SELECT COUNT(*) as n FROM vector_meta');
    return rows[0]?.n ?? 0;
  }

  protected async doWipe(): Promise<void> {
    await this.sqlite.execute('DELETE FROM vector_vec0');
    await this.sqlite.execute('DELETE FROM vector_meta');
  }
}
