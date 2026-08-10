import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * Migration runner + connection lifecycle over `SqlitePort` — TZ §8.1.
 * Numbered migrations under `./migrations/` are applied in order, each in
 * its own transaction, tracked in `_local_ai_migrations`. Platform-neutral —
 * works identically against `CapacitorSqliteAdapter` or `NodeSqliteAdapter`,
 * since it only calls `SqlitePort` methods.
 */
export class Database {
  constructor(
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Applies every migration from `MIGRATIONS` not yet recorded in
   * `_local_ai_migrations`, in ascending `id` order, each inside its own
   * transaction. Safe to call on every app start — a fully up-to-date
   * database is a no-op.
   */
  async migrate(): Promise<void> {
    // Bootstrap: the tracking table must exist before we can query it, even
    // before migration 001 (which also creates it — CREATE TABLE IF NOT
    // EXISTS makes that redundant call harmless).
    await this.sqlite.execute(
      `CREATE TABLE IF NOT EXISTS _local_ai_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
    );

    const appliedRows = await this.sqlite.query<{ id: number }>('SELECT id FROM _local_ai_migrations');
    const applied = new Set(appliedRows.map((r) => r.id));

    const pending = MIGRATIONS.filter((m) => !applied.has(m.id)).sort((a, b) => a.id - b.id);

    for (const migration of pending) {
      await this.sqlite.transaction(async (tx) => {
        await tx.execute(migration.sql);
        await tx.execute('INSERT INTO _local_ai_migrations (id, name, applied_at) VALUES (?, ?, ?)', [
          migration.id,
          migration.name,
          this.clock.nowIso(),
        ]);
      });
    }
  }

  /** Underlying port, for callers (`ConversationStore`, `VectorStore`, …) that need direct SQL access. */
  get port(): SqlitePort {
    return this.sqlite;
  }

  async close(): Promise<void> {
    await this.sqlite.close();
  }
}
