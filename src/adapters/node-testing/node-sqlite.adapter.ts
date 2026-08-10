import type { SqlitePort, SqliteRow } from '../../core/ports/sqlite.port.js';

/**
 * Not implemented — Phase 3 (ROADMAP.md). `node:sqlite`'s `DatabaseSync` as
 * the Node-testing reference implementation (TZ §13.1). Originally scoped as
 * `better-sqlite3` + `sqlite-vec`; switched to Node's built-in `node:sqlite`
 * after `better-sqlite3`'s prebuilt native binary was found to crash in the
 * dev environment this project was built in — see
 * `docs/decisions.md`'s "Implementation/tooling notes" section and ADR
 * `docs/adr/0002-sqlite-vec-load-extension.md`. Consequence:
 * `loadVectorExtension()` here is a documented no-op (`node:sqlite` doesn't
 * yet expose `loadExtension`/`enableLoadExtension` as of the Node version
 * pinned in `engines`) — the brute-force `VectorStore` fallback is what gets
 * exercised against this adapter; the sqlite-vec path stays validated on the
 * production `CapacitorSqliteAdapter` path only (real device, Phase 0 ADR
 * 0002 not yet `accepted`).
 */
export class NodeSqliteAdapter implements SqlitePort {
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

  /** Always resolves `false` on this adapter — see class doc. */
  async loadVectorExtension(): Promise<boolean> {
    return false;
  }
}
