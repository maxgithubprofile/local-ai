import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import { SqliteVecVectorStore } from './sqlite-vec-vector-store.js';
import { BruteForceVectorStore } from './brute-force-vector-store.js';
import type { VectorStore } from './vector-store.js';

function float32ToBlob(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Exercises the exact `vec0` SQL `SqliteVecVectorStore` relies on
 * (`distance_metric=cosine` column option, `k = ?` KNN clause) against a
 * throwaway, uniquely-named virtual table — deliberately **not**
 * `vector_vec0`/`vector_meta` (the real tables), so this can never touch or
 * destroy a caller's already-populated vector store, regardless of when
 * `createVectorStore()` runs (first-ever launch or the hundredth).
 */
async function selfTestSqliteVec(sqlite: SqlitePort): Promise<boolean> {
  const table = '__local_ai_vec_selftest__';
  try {
    await sqlite.execute(`DROP TABLE IF EXISTS ${table}`);
    await sqlite.execute(`CREATE VIRTUAL TABLE ${table} USING vec0(embedding float[4] distance_metric=cosine)`);
    const probe = float32ToBlob(new Float32Array([1, 0, 0, 0]));
    await sqlite.execute(`INSERT INTO ${table}(rowid, embedding) VALUES (1, ?)`, [probe]);
    await sqlite.query(`SELECT rowid, distance FROM ${table} WHERE embedding MATCH ? AND k = 1`, [probe]);
    return true;
  } catch {
    return false;
  } finally {
    await sqlite.execute(`DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
  }
}

/**
 * Picks a `VectorStore` implementation opportunistically (TZ §8.3): tries
 * `sqlite-vec` via `SqlitePort.loadVectorExtension()`, then self-tests the
 * actual `vec0` SQL on a disposable table (a successful `loadExtension()`
 * doesn't by itself guarantee this exact syntax matches the bundled
 * sqlite-vec version — `docs/adr/0002-sqlite-vec-load-extension.md` is
 * `proposed`, not `accepted`). Falls back to `BruteForceVectorStore` on any
 * failure at either step, emitting no error — `usedFallback: true` is the
 * caller's (`LocalAiClient`'s) signal to raise the public
 * `vector-store:fallback-active` event, not this function's job.
 */
export async function createVectorStore(
  sqlite: SqlitePort,
  clock: ClockPort,
): Promise<{ store: VectorStore; usedFallback: boolean }> {
  const extensionLoaded = (await sqlite.loadVectorExtension?.()) ?? false;
  const sqliteVecWorks = extensionLoaded && (await selfTestSqliteVec(sqlite));

  if (sqliteVecWorks) {
    return { store: new SqliteVecVectorStore(sqlite, clock), usedFallback: false };
  }
  return { store: new BruteForceVectorStore(sqlite, clock), usedFallback: true };
}
