/**
 * Backing table for `LogStore` (ROADMAP.md's "Local logging & export"
 * section, LOG.1) — a local, persisted log store the host app can read back
 * later via `LocalAiClient.exportLogs()`. Not a TZ §8.1 table (the TZ only
 * specifies a pass-through `logger?: LocalAiLogger` callback, no persisted
 * storage) — see `docs/decisions.md`'s "Local logging & export
 * (2026-08-11, requested)" entry for why a SQLite table was chosen over a
 * rotating file.
 *
 * `ts` is `TEXT` ISO-8601 via `ClockPort.nowIso()`, same convention as
 * every other `*_at`/timestamp column in this schema (`chats.created_at`,
 * `installed_artifacts.installed_at`, …) — never `Date.now()`/`new Date()`
 * directly. `LogStore.append()` prunes rows past `maxEntries` in the same
 * transaction as the insert, so this table is bounded, not append-forever.
 */
export const sql = `
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message TEXT NOT NULL,
  meta_json TEXT           -- nullable JSON, JSON.stringify'd structured payload
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
`;
