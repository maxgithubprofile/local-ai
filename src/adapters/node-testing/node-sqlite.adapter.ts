import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { SqlitePort, SqliteRow } from '../../core/ports/sqlite.port.js';

// `process.getBuiltinModule()` (Node ≥20.16) rather than a static
// `import { DatabaseSync } from 'node:sqlite'` — Vite/Vitest's SSR module
// graph (used by `vitest run`) doesn't resolve `node:sqlite` on the Vite
// version this repo pins, treating it as a bare `sqlite` package import
// instead of a builtin. Fetching it as a builtin at call time sidesteps
// that resolution step entirely and needs no bundler config either way.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

/**
 * `node:sqlite`'s `DatabaseSync` as the Node-testing `SqlitePort`
 * implementation (TZ §13.1). Originally scoped as `better-sqlite3` +
 * `sqlite-vec`; switched to Node's built-in `node:sqlite` after
 * `better-sqlite3`'s prebuilt native binary was found to crash in the dev
 * environment this project was built in — see `docs/decisions.md`'s
 * "Implementation/tooling notes" section and
 * `docs/adr/0002-sqlite-vec-load-extension.md`. Requires Node started with
 * `--experimental-sqlite` (this repo's `test:*` scripts set it via
 * `NODE_OPTIONS`, see `package.json`) until the flag is dropped upstream.
 *
 * `execute()` without `params` runs `sql` through `DatabaseSync.exec()`,
 * which (unlike a prepared statement) supports multiple `;`-separated
 * statements in one string — needed for the migration runner, which hands
 * a whole migration file's contents to a single `execute()` call.
 */
export class NodeSqliteAdapter implements SqlitePort {
  private readonly db: DatabaseSyncType;
  // Serializes transaction() calls, same reasoning and shape as
  // `CapacitorSqliteAdapter`'s `transactionChain` (see
  // `docs/decisions.md`'s "CapacitorSqliteAdapter concurrent-connection/
  // transaction hardening" entry, and `SqlitePort.transaction()`'s doc
  // comment): `DatabaseSync.exec('BEGIN')` while another transaction is
  // still open throws, so overlapping callers must queue rather than race.
  private transactionChain: Promise<unknown> = Promise.resolve();

  constructor(path: string = ':memory:') {
    this.db = new DatabaseSync(path);
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    if (params && params.length > 0) {
      this.db.prepare(sql).run(...(params as never[]));
    } else {
      this.db.exec(sql);
    }
  }

  async query<T extends SqliteRow = SqliteRow>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = params && params.length > 0 ? stmt.all(...(params as never[])) : stmt.all();
    return rows as T[];
  }

  async transaction<T>(fn: (tx: SqlitePort) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.db.exec('BEGIN');
      try {
        const result = await fn(this);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
    const scheduled = this.transactionChain.then(run, run);
    this.transactionChain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Always resolves `false` on this adapter — `node:sqlite` doesn't yet expose `loadExtension`. See class doc. */
  async loadVectorExtension(): Promise<boolean> {
    return false;
  }
}
