import type { AppLifecyclePort } from '../../core/ports/app-lifecycle.port.js';
import type { Unsubscribe } from '../../core/types.js';

/**
 * Not implemented — Phase 6 (ROADMAP.md). Wraps
 * `App.addListener('appStateChange', ...)` from `@capacitor/app` (TZ §4.6,
 * §11.2). Only consulted when `autoUnloadOnBackground` is opted into.
 */
export class CapacitorAppLifecycleAdapter implements AppLifecyclePort {
  onStateChange(_cb: (state: { isActive: boolean }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §4.6, §11.2, ROADMAP Phase 6');
  }
}
