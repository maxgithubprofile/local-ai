import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SqlitePort, SqliteRow } from '../../core/ports/sqlite.port.js';

/**
 * Wraps `@capacitor-community/sqlite` (TZ §4.2). `execute()` (no params) maps
 * to the connection's `execute(statements)` — supports multiple `;`-separated
 * statements in one call, needed for the migration runner. `execute()`/`query()`
 * with `params` map to `run()`/`query(statement, values)` — single
 * parameterized statements.
 *
 * `loadVectorExtension()` attempts `enableLoadExtension(true)` +
 * `loadExtension(extensionPath)` and resolves `false` (never throws) if
 * unsupported — risk flagged for iOS specifically
 * (`docs/adr/0002-sqlite-vec-load-extension.md`, `proposed`, not
 * `accepted` — no device to confirm). `extensionPath` defaults to `'vec0'`,
 * the conventional loadable-extension name `sqlite-vec` publishes under —
 * getting the actual compiled `vec0` binary bundled into the native
 * Android/iOS build is a build-integration step outside what this adapter
 * can do on its own; pass an explicit path if the consuming app's build
 * places it somewhere else.
 */
export class CapacitorSqliteAdapter implements SqlitePort {
  private readonly connectionApi = new SQLiteConnection(CapacitorSQLite);
  private connection: SQLiteDBConnection | null = null;
  // Caches the in-flight open, not just the settled result: two callers
  // racing into getConnection() before the first `await` inside
  // openConnection() returns must share one native `createConnection()`
  // call, or the second throws "Connection ... already exists". Reset on
  // failure so a genuine open error doesn't permanently wedge future calls.
  private connectionPromise: Promise<SQLiteDBConnection> | null = null;
  // Serializes transaction() calls on this instance: `beginTransaction()`
  // while another transaction is still open throws "Already in transaction"
  // on the shared native connection, so overlapping callers must queue
  // rather than race. `.then(run, run)` runs the next transaction once the
  // previous one *settles*, success or failure, and the `.catch()` keeps
  // the chain itself always-resolving so a failed transaction doesn't
  // permanently block the ones queued after it.
  private transactionChain: Promise<unknown> = Promise.resolve();
  // True while running inside transaction()'s fn(this) callback. execute()
  // consults this to tell the native plugin NOT to auto-wrap its own call in
  // another transaction — @capacitor-community/sqlite's execute()/run()
  // default their `transaction` param to true, so calling them unmodified
  // from inside an already-open transaction() nests a second
  // beginTransaction() on the same connection and the native plugin throws
  // "Already in transaction" (found on-device, forta.chat AI-chat migration
  // runner: transaction() -> tx.execute(migrationSql) reproduced this
  // exactly — Node adapters/tests never caught it, neither better-sqlite3
  // nor node:sqlite has this "auto-transaction-wraps-every-call" behavior).
  private inTransaction = false;

  constructor(private readonly databaseName: string = 'local_ai') {}

  private async getConnection(): Promise<SQLiteDBConnection> {
    if (this.connection) return this.connection;
    if (!this.connectionPromise) {
      this.connectionPromise = this.openConnection().catch((err: unknown) => {
        this.connectionPromise = null;
        throw err;
      });
    }
    return this.connectionPromise;
  }

  private async openConnection(): Promise<SQLiteDBConnection> {
    // A second `CapacitorSqliteAdapter`/`LocalAiClient` instance opening the
    // same `databaseName` (e.g. a caller that doesn't memoize
    // `LocalAiClient.create()` and re-invokes it) hits this same native
    // connection registry, outside what the connectionPromise cache above
    // can protect against — reuse the existing native connection instead of
    // blindly creating a second one and throwing "already exists".
    const { result: alreadyRegistered } = await this.connectionApi.isConnection(this.databaseName, false);
    const conn = alreadyRegistered
      ? await this.connectionApi.retrieveConnection(this.databaseName, false)
      : await this.connectionApi.createConnection(this.databaseName, false, 'no-encryption', 1, false);
    const { result: alreadyOpen } = await conn.isDBOpen();
    if (!alreadyOpen) {
      await conn.open();
    }
    this.connection = conn;
    return conn;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const conn = await this.getConnection();
    // See `inTransaction` doc comment: suppress the plugin's own implicit
    // transaction wrapping while transaction() already has one open.
    const autoTransaction = !this.inTransaction;
    if (params && params.length > 0) {
      await conn.run(sql, params, autoTransaction);
    } else {
      await conn.execute(sql, autoTransaction);
    }
  }

  async query<T extends SqliteRow = SqliteRow>(sql: string, params?: unknown[]): Promise<T[]> {
    const conn = await this.getConnection();
    const result = await conn.query(sql, params);
    const values = (result.values ?? []) as Record<string, unknown>[];
    // Defensive: older/raw-plugin-level iOS paths have historically returned
    // a leading `ios_columns` sentinel row instead of real data — the
    // higher-level `SQLiteDBConnection.query()` used here shouldn't, but
    // this is cheap insurance against that legacy quirk resurfacing.
    return values.filter((row) => !('ios_columns' in row)) as T[];
  }

  async transaction<T>(fn: (tx: SqlitePort) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const conn = await this.getConnection();
      await conn.beginTransaction();
      this.inTransaction = true;
      try {
        const result = await fn(this);
        await conn.commitTransaction();
        return result;
      } catch (err) {
        await conn.rollbackTransaction();
        throw err;
      } finally {
        this.inTransaction = false;
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
    if (!this.connection) return;
    await this.connection.close();
    await this.connectionApi.closeConnection(this.databaseName, false);
    this.connection = null;
    this.connectionPromise = null;
  }

  async loadVectorExtension(extensionPath: string = 'vec0'): Promise<boolean> {
    try {
      const conn = await this.getConnection();
      await conn.enableLoadExtension(true);
      await conn.loadExtension(extensionPath);
      return true;
    } catch {
      return false;
    }
  }
}
