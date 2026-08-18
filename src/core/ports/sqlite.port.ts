/** One result row — untyped at the port boundary, narrowed by each caller. */
export type SqliteRow = Record<string, unknown>;

/**
 * Minimal SQL port both `Database`/`ConversationStore`/`VectorStore` and
 * the migration runner (TZ §8.1) depend on. Implemented by
 * `CapacitorSqliteAdapter` (`@capacitor-community/sqlite`, TZ §4.2) in
 * production and `NodeSqliteAdapter` (`node:sqlite`'s `DatabaseSync`, see
 * `docs/decisions.md`'s tooling-notes section) in tests (TZ §13.1).
 * `loadExtension` is intentionally out of this base
 * port — it's `sqlite-vec`-specific and risky on iOS (TZ §8.3), so it's
 * exposed as an optional capability rather than a required method every
 * adapter must implement.
 */
export interface SqlitePort {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T extends SqliteRow = SqliteRow>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Runs `fn` inside a `BEGIN`/`COMMIT` (or `ROLLBACK` on throw). **Overlapping
   * calls on the same adapter instance must queue, not race** — a second
   * `transaction()` starting before the first has committed/rolled back must
   * wait for it, never throw "already in transaction"/"cannot start a
   * transaction within a transaction" on the underlying connection. This is
   * the adapter's responsibility, not the caller's: `SqlitePort` is a
   * hexagonal boundary (CLAUDE.md) implemented by code outside `core/**`'s
   * control, so `core/**` callers (and library consumers driving multiple
   * `LocalAiClient` calls concurrently) cannot be relied on to serialize
   * their own calls. See `docs/decisions.md`'s "`CapacitorSqliteAdapter`
   * concurrent-connection/transaction hardening" entry for the incident that
   * made this explicit, and this port's contract test
   * (`test/contract/sqlite-port.contract.ts`) for the scenario that pins it.
   */
  transaction<T>(fn: (tx: SqlitePort) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Best-effort `sqlite-vec` (`vec0`) loading — resolves `false` instead of throwing if unsupported, so callers can fall back (TZ §8.3). */
  loadVectorExtension?(): Promise<boolean>;
}
