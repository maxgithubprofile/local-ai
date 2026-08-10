/**
 * Not implemented — Phase 3 (ROADMAP.md). Migration runner + connection
 * lifecycle over `SqlitePort`. Migrations are numbered files under
 * `./migrations/`, each applied in its own transaction, tracked in
 * `_local_ai_migrations` (TZ §8.1). Platform-neutral — works against
 * `CapacitorSqliteAdapter` or `BetterSqliteAdapter` identically.
 */
export class Database {
  async migrate(): Promise<never> {
    throw new Error('not implemented — see TZ §8.1, ROADMAP Phase 3');
  }
}
