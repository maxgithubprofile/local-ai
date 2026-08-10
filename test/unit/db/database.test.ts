import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/core/db/database.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';

describe('Database.migrate()', () => {
  it('applies 001_init and creates every table TZ §8.1 expects', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    const db = new Database(sqlite, new FakeClockAdapter());

    await db.migrate();

    const tables = await sqlite.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    for (const expected of [
      '_local_ai_migrations',
      'kv_store',
      'installed_artifacts',
      'download_state',
      'chats',
      'chat_messages',
      'vector_space',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('records the applied migration with a timestamp from ClockPort', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    const clock = new FakeClockAdapter(new Date('2026-03-01T12:00:00.000Z'));
    const db = new Database(sqlite, clock);

    await db.migrate();

    const rows = await sqlite.query<{ id: number; name: string; applied_at: string }>(
      'SELECT id, name, applied_at FROM _local_ai_migrations',
    );
    expect(rows).toEqual([{ id: 1, name: '001_init', applied_at: '2026-03-01T12:00:00.000Z' }]);
  });

  it('is idempotent — calling migrate() twice does not re-apply or throw', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    const db = new Database(sqlite, new FakeClockAdapter());

    await db.migrate();
    await db.migrate();

    const rows = await sqlite.query('SELECT * FROM _local_ai_migrations');
    expect(rows).toHaveLength(1);
  });

  it('cascade-deletes chat_messages when the parent chat is deleted (FK enforced)', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    const db = new Database(sqlite, new FakeClockAdapter());
    await db.migrate();
    // node:sqlite (like most sqlite drivers) needs foreign_keys turned on explicitly.
    await sqlite.execute('PRAGMA foreign_keys = ON');

    await sqlite.execute('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'chat-1',
      'Test',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    await sqlite.execute(
      'INSERT INTO chat_messages (chat_id, id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ['chat-1', 'msg-1', 'user', 'hi', '2026-01-01T00:00:00.000Z'],
    );

    await sqlite.execute('DELETE FROM chats WHERE id = ?', ['chat-1']);

    const remaining = await sqlite.query('SELECT * FROM chat_messages');
    expect(remaining).toHaveLength(0);
  });
});
