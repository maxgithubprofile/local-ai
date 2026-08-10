import { sql as sql001 } from './001_init.js';

/** One numbered migration — applied in order, tracked by `id` in `_local_ai_migrations`. */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Ordered migration list — `Database.migrate()` (`../database.ts`) applies
 * these in order, each inside its own transaction. Append-only: a shipped
 * migration's `sql` must never change after merge (`add-migration` skill,
 * step 4) — a correction is itself a new, higher-numbered migration.
 */
export const MIGRATIONS: Migration[] = [{ id: 1, name: '001_init', sql: sql001 }];
