/** One result row — untyped at the port boundary, narrowed by each caller. */
export type SqliteRow = Record<string, unknown>;

/**
 * Minimal SQL port both `Database`/`ConversationStore`/`VectorStore` and
 * the migration runner (TZ §8.1) depend on. Implemented by
 * `CapacitorSqliteAdapter` (`@capacitor-community/sqlite`, TZ §4.2) in
 * production and `BetterSqliteAdapter` (`better-sqlite3` + `sqlite-vec`)
 * in tests (TZ §13.1). `loadExtension` is intentionally out of this base
 * port — it's `sqlite-vec`-specific and risky on iOS (TZ §8.3), so it's
 * exposed as an optional capability rather than a required method every
 * adapter must implement.
 */
export interface SqlitePort {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T extends SqliteRow = SqliteRow>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: SqlitePort) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Best-effort `sqlite-vec` (`vec0`) loading — resolves `false` instead of throwing if unsupported, so callers can fall back (TZ §8.3). */
  loadVectorExtension?(): Promise<boolean>;
}
