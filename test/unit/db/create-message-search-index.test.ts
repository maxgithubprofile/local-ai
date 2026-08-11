import { describe, expect, it } from 'vitest';
import { createMessageSearchIndex } from '../../../src/core/db/create-message-search-index.js';
import { LikeMessageSearchIndex } from '../../../src/core/db/like-message-search-index.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';

describe('createMessageSearchIndex()', () => {
  it('falls back to LikeMessageSearchIndex when FTS5 is not compiled into this SQLite build (Phase 8, docs/decisions.md)', async () => {
    // Confirmed by direct test in this environment: node:sqlite's DatabaseSync
    // (Node 22.x, --experimental-sqlite) does not have the fts5 module —
    // `CREATE VIRTUAL TABLE ... USING fts5(...)` throws `no such module: fts5`.
    // Same residual-risk shape as ADR 0002 (sqlite-vec) — Fts5MessageSearchIndex
    // needs a real device/Capacitor-SQLite build to be exercised.
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();

    const { index, usedFallback } = await createMessageSearchIndex(sqlite);

    expect(usedFallback).toBe(true);
    expect(index).toBeInstanceOf(LikeMessageSearchIndex);
  });

  it('the fallback index is immediately usable', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();
    const { index } = await createMessageSearchIndex(sqlite);

    await sqlite.execute('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'c1',
      'c1',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    await sqlite.execute('INSERT INTO chat_messages (chat_id, id, role, content, created_at) VALUES (?, ?, ?, ?, ?)', [
      'c1',
      'm1',
      'user',
      'searchable content',
      '2026-01-01T00:00:00.000Z',
    ]);

    expect(await index.search('searchable')).toHaveLength(1);
  });

  it('the self-test never leaves its throwaway table behind', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();
    await createMessageSearchIndex(sqlite);

    const rows = await sqlite.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__local_ai_fts_selftest__'",
    );
    expect(rows).toEqual([]);
  });
});
