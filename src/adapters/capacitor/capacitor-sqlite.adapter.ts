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

  constructor(private readonly databaseName: string = 'local_ai') {}

  private async getConnection(): Promise<SQLiteDBConnection> {
    if (this.connection) return this.connection;
    this.connection = await this.connectionApi.createConnection(this.databaseName, false, 'no-encryption', 1, false);
    await this.connection.open();
    return this.connection;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const conn = await this.getConnection();
    if (params && params.length > 0) {
      await conn.run(sql, params);
    } else {
      await conn.execute(sql);
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
    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      const result = await fn(this);
      await conn.commitTransaction();
      return result;
    } catch (err) {
      await conn.rollbackTransaction();
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.connection) return;
    await this.connection.close();
    await this.connectionApi.closeConnection(this.databaseName, false);
    this.connection = null;
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
