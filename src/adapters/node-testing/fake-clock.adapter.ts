import type { ClockPort } from '../../core/ports/clock.port.js';

/**
 * Controllable clock for deterministic tests (migration timestamps,
 * download retry backoff, `chats.updated_at`) — construct with a fixed
 * `Date`, advance it explicitly with {@link FakeClockAdapter.advance}.
 */
export class FakeClockAdapter implements ClockPort {
  private current: Date;

  constructor(initial: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = initial;
  }

  now(): Date {
    return this.current;
  }

  nowIso(): string {
    return this.current.toISOString();
  }

  /** Moves the fake clock forward by `ms` milliseconds (or backward, if negative). */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  /** Sets the fake clock to an explicit point in time. */
  set(date: Date): void {
    this.current = date;
  }
}
