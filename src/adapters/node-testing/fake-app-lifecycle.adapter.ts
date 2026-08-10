import type { AppLifecyclePort } from '../../core/ports/app-lifecycle.port.js';
import type { Unsubscribe } from '../../core/types.js';

/**
 * In-memory `AppLifecyclePort` fake — lets tests simulate foreground/
 * background transitions via {@link FakeAppLifecycleAdapter.setActive}
 * without a real Capacitor `App` plugin (TZ §11.2). The real
 * `CapacitorAppLifecycleAdapter` is Phase 6 scope; this fake is pulled
 * forward because `LocalAiClient.create()` requires every `LocalAiPorts`
 * key to be present (hexagonal boundary — core can't default a missing
 * port itself), so Phase 4's integration tests need *some*
 * `AppLifecyclePort` even though nothing reacts to it yet.
 */
export class FakeAppLifecycleAdapter implements AppLifecyclePort {
  private readonly listeners = new Set<(state: { isActive: boolean }) => void>();

  onStateChange(cb: (state: { isActive: boolean }) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Simulates the app moving to the foreground/background. */
  setActive(isActive: boolean): void {
    for (const cb of this.listeners) cb({ isActive });
  }
}
