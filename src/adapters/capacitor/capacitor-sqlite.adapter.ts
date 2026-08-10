import type { SqlitePort, SqliteRow } from '../../core/ports/sqlite.port.js';

/**
 * Not implemented — Phase 3 (ROADMAP.md). Wraps `@capacitor-community/sqlite`
 * (TZ §4.2). `loadVectorExtension()` attempts `loadExtension('sqlite-vec')`
 * and resolves `false` (not throws) on platforms where it's unsupported —
 * risk flagged for iOS specifically, Phase 0 spike + fallback TZ §8.3.
 */
export class CapacitorSqliteAdapter implements SqlitePort {
  async execute(_sql: string, _params?: unknown[]): Promise<void> {
    throw new Error('not implemented — see TZ §4.2, ROADMAP Phase 3');
  }

  async query<T extends SqliteRow = SqliteRow>(_sql: string, _params?: unknown[]): Promise<T[]> {
    throw new Error('not implemented — see TZ §4.2, ROADMAP Phase 3');
  }

  async transaction<T>(_fn: (tx: SqlitePort) => Promise<T>): Promise<T> {
    throw new Error('not implemented — see TZ §4.2, ROADMAP Phase 3');
  }

  async close(): Promise<void> {
    throw new Error('not implemented — see TZ §4.2, ROADMAP Phase 3');
  }

  async loadVectorExtension(): Promise<boolean> {
    throw new Error('not implemented — see TZ §8.3, ROADMAP Phase 3');
  }
}
