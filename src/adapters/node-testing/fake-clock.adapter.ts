import type { ClockPort } from '../../core/ports/clock.port.js';

/**
 * Not implemented — Phase 1 (ROADMAP.md). Controllable clock for
 * deterministic tests (migration timestamps, download retry backoff,
 * `chats.updated_at`) — construct with a fixed/advanceable `Date`.
 */
export class FakeClockAdapter implements ClockPort {
  now(): Date {
    throw new Error('not implemented — see ROADMAP Phase 1');
  }

  nowIso(): string {
    throw new Error('not implemented — see ROADMAP Phase 1');
  }
}
