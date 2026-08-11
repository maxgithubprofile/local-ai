import type { SqlitePort, SqliteRow } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { LogEntry, LogLevel } from '../types.js';
import { levelMeetsThreshold } from './log-levels.js';

interface LogRow extends SqliteRow {
  id: number;
  ts: string;
  level: LogLevel;
  message: string;
  meta_json: string | null;
}

function rowToEntry(row: LogRow): LogEntry {
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    message: row.message,
    meta: row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : undefined,
  };
}

/** Default cap on stored rows before `append()` starts pruning the oldest ones — LOG.1/LOG.2, `docs/decisions.md`'s "Local logging & export" entry. */
export const DEFAULT_LOG_MAX_ENTRIES = 5000;

/**
 * SQL-backed implementation of the `logs` table (`004_logs.ts`) — wraps
 * `SqlitePort` directly, same shape as `ConversationStore`, deliberately
 * *not* a new port: this is an internal bookkeeping table `local-ai` itself
 * owns, not a platform capability `core/**` needs to reach through
 * (CLAUDE.md's `new-port` rule only applies to the latter). Bounded by
 * `maxEntries` — same "hard cap, prune oldest" shape as `SessionCache`'s LRU
 * (`docs/decisions.md` #8), except here every `append()` prunes rather than
 * evicting on overflow of an in-process structure, since this is the SQL
 * table itself, not an in-memory index over it.
 */
export class LogStore {
  private readonly maxEntries: number;

  constructor(
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
    options?: { maxEntries?: number },
  ) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_LOG_MAX_ENTRIES;
  }

  /**
   * Inserts one row (`ts` stamped from `ClockPort.nowIso()`, never
   * `Date.now()`/`new Date()` directly) and, in the same transaction,
   * deletes any rows past `maxEntries` — oldest (`lowest id`) first. A
   * single `append()` call can never itself leave more than `maxEntries`
   * rows behind, regardless of how many existed before it.
   */
  async append(entry: { level: LogLevel; message: string; meta?: Record<string, unknown> }): Promise<void> {
    const ts = this.clock.nowIso();
    const metaJson = entry.meta ? JSON.stringify(entry.meta) : null;
    await this.sqlite.transaction(async (tx) => {
      await tx.execute('INSERT INTO logs (ts, level, message, meta_json) VALUES (?, ?, ?, ?)', [
        ts,
        entry.level,
        entry.message,
        metaJson,
      ]);
      await tx.execute('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)', [
        this.maxEntries,
      ]);
    });
  }

  /**
   * Reads entries oldest-first (same chronological-read convention as
   * `ConversationStore.getMessages()`), optionally filtered by `since` (ISO
   * string, `ts >=`) and/or `level` — `level` is a *minimum severity*
   * threshold (`levelMeetsThreshold`), not an exact match, matching how
   * `LocalAiConfig.logging.minLevel` already gates capture.
   */
  async query(options?: { since?: string; level?: LogLevel; limit?: number; offset?: number }): Promise<LogEntry[]> {
    let sql = 'SELECT * FROM logs';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (options?.since) {
      conditions.push('ts >= ?');
      params.push(options.since);
    }
    if (options?.level) {
      // level is a minimum-severity threshold (levelMeetsThreshold), not an
      // exact match — expand to the small fixed set of levels that qualify
      // so LIMIT/OFFSET below still apply to the right underlying rows
      // (filtering in TS *after* a SQL LIMIT would silently return fewer
      // than `limit` rows whenever a less-severe level got paged out).
      const qualifying = (['debug', 'info', 'warn', 'error'] as const).filter((l) =>
        levelMeetsThreshold(l, options.level!),
      );
      conditions.push(`level IN (${qualifying.map(() => '?').join(', ')})`);
      params.push(...qualifying);
    }
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY id ASC';
    if (options?.limit) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(options.limit, options.offset ?? 0);
    }

    const rows = await this.sqlite.query<LogRow>(sql, params);
    return rows.map(rowToEntry);
  }

  async clear(): Promise<void> {
    await this.sqlite.execute('DELETE FROM logs');
  }
}
