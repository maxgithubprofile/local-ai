import type { SqlitePort, SqliteRow } from '../../core/ports/sqlite.port.js';

/**
 * Not implemented — Phase 3 (ROADMAP.md). `better-sqlite3` + the
 * `sqlite-vec` npm package as the primary-path reference implementation
 * used in Node tests — TZ §13.1. Add `better-sqlite3`/`sqlite-vec` to
 * devDependencies when this is implemented (deliberately not installed by
 * the initial bootstrap, see ROADMAP.md Phase 3).
 */
export class BetterSqliteAdapter implements SqlitePort {
  async execute(_sql: string, _params?: unknown[]): Promise<void> {
    throw new Error('not implemented — see TZ §8, §13.1, ROADMAP Phase 3');
  }

  async query<T extends SqliteRow = SqliteRow>(_sql: string, _params?: unknown[]): Promise<T[]> {
    throw new Error('not implemented — see TZ §8, §13.1, ROADMAP Phase 3');
  }

  async transaction<T>(_fn: (tx: SqlitePort) => Promise<T>): Promise<T> {
    throw new Error('not implemented — see TZ §8, §13.1, ROADMAP Phase 3');
  }

  async close(): Promise<void> {
    throw new Error('not implemented — see TZ §8, §13.1, ROADMAP Phase 3');
  }

  async loadVectorExtension(): Promise<boolean> {
    throw new Error('not implemented — see TZ §8.3, §13.1, ROADMAP Phase 3');
  }
}
