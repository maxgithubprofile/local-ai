/**
 * Trivial time source port — exists purely so `core/**` never calls
 * `Date.now()`/`new Date()` directly, keeping timestamp-dependent logic
 * (migrations, download retry backoff, `chats.updated_at`, …)
 * deterministically testable with a `FakeClockAdapter`.
 */
export interface ClockPort {
  now(): Date;
  /** ISO-8601 string, the format persisted in every `*_at` column (TZ §8.1). */
  nowIso(): string;
}
