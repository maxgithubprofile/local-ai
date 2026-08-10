import type { ClockPort } from '../../core/ports/clock.port.js';

/**
 * Real wall-clock `ClockPort` — `new Date()`/`.toISOString()`, nothing
 * platform-specific. Shared by every platform (TZ §3.1) the same way
 * {@link ../shared/web-crypto-hash.adapter.js} is: `Date` behaves
 * identically in Node and any Capacitor WebView, so there's no reason for
 * a dedicated Capacitor adapter — `FakeClockAdapter`
 * (`adapters/node-testing/fake-clock.adapter.ts`) is the *only* other
 * `ClockPort` implementation, and it exists purely for deterministic tests.
 */
export class SystemClockAdapter implements ClockPort {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return new Date().toISOString();
  }
}
