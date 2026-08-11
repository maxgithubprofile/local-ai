import type { SqlitePort } from '../ports/sqlite.port.js';
import { Fts5MessageSearchIndex } from './fts5-message-search-index.js';
import { LikeMessageSearchIndex } from './like-message-search-index.js';
import type { MessageSearchIndex } from './message-search-index.js';

/**
 * Exercises real FTS5 SQL against a disposable, uniquely-named table —
 * never the real `chat_messages_fts` — so this can never touch/corrupt a
 * caller's already-populated index, regardless of when
 * `createMessageSearchIndex()` runs. Mirrors `create-vector-store.ts`'s
 * `selfTestSqliteVec()` exactly.
 */
async function selfTestFts5(sqlite: SqlitePort): Promise<boolean> {
  const table = '__local_ai_fts_selftest__';
  try {
    await sqlite.execute(`DROP TABLE IF EXISTS ${table}`);
    await sqlite.execute(`CREATE VIRTUAL TABLE ${table} USING fts5(content)`);
    await sqlite.execute(`INSERT INTO ${table}(rowid, content) VALUES (1, 'local-ai fts5 self-test')`);
    await sqlite.query(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`, ['self-test']);
    return true;
  } catch {
    return false;
  } finally {
    await sqlite.execute(`DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
  }
}

/**
 * Picks a {@link MessageSearchIndex} implementation opportunistically —
 * Phase 8, `docs/decisions.md`'s "Full-text search" entry, same
 * opportunistic-primary/self-tested/silent-fallback shape as
 * `createVectorStore()`. `usedFallback: true` is the caller's
 * (`LocalAiClient`'s) signal to emit the public
 * `chat-search:fallback-active` event, not this function's job.
 */
export async function createMessageSearchIndex(sqlite: SqlitePort): Promise<{ index: MessageSearchIndex; usedFallback: boolean }> {
  const fts5Works = await selfTestFts5(sqlite);
  if (fts5Works) {
    return { index: new Fts5MessageSearchIndex(sqlite), usedFallback: false };
  }
  return { index: new LikeMessageSearchIndex(sqlite), usedFallback: true };
}
