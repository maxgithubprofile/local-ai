import type { LogLevel } from '../types.js';

/** Severity order backing every `LogLevel` comparison in this package — `debug` is least severe. */
const LOG_LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * `true` when `level` is at least as severe as `minLevel` — the single rule
 * behind `LocalAiConfig.logging.minLevel` (`LocalAiClient`'s dispatch
 * helper) and `LogStore.query()`'s `level` filter alike. Pure/sync so it's
 * unit-testable without a `SqlitePort` or a `LocalAiClient` instance
 * (LOG.5, ROADMAP.md's "Local logging & export" section).
 */
export function levelMeetsThreshold(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];
}
