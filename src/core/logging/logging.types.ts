import type { LogEntry, LogLevel } from '../types.js';

/**
 * Export/clear surface over the persisted `LogStore` — ROADMAP.md's "Local
 * logging & export" section, no TZ section (see `docs/decisions.md`'s entry
 * of the same name), same "library returns data, host app owns the native
 * save/share flow" split as `ChatExportApi` (Phase 8). Implemented by
 * `LocalAiClient`, backed by `LogStore`. Populated only for entries captured
 * while `LocalAiConfig.logging.enabled` was `true` — this API works
 * regardless of whether the pluggable `LocalAiConfig.logger` callback is
 * also configured; the two are independent (`docs/decisions.md`).
 */
export interface LogExportApi {
  /**
   * Reads persisted log entries, oldest first. `options.level` is a
   * minimum-severity threshold (e.g. `'warn'` returns `warn` and `error`
   * entries too), not an exact match.
   */
  exportLogs(options?: { since?: Date; level?: LogLevel; limit?: number }): Promise<LogEntry[]>;
  /** Deletes every persisted log entry. Does not affect the pluggable `logger` callback, which isn't stateful. */
  clearLogs(): Promise<void>;
}
