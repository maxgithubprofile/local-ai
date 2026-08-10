import type { PlatformSupportPort } from '../../core/ports/platform-support.port.js';

/**
 * Not implemented — Phase 1 (ROADMAP.md). Thin wrapper over
 * `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()` /
 * `Capacitor.isPluginAvailable()` (official Capacitor core API, TZ §6.1) —
 * nothing bespoke. Requires `@capacitor/core` as a peer dependency.
 */
export class CapacitorPlatformSupportAdapter implements PlatformSupportPort {
  isNativePlatform(): boolean {
    throw new Error('not implemented — see TZ §6.1, ROADMAP Phase 1');
  }

  getPlatform(): 'ios' | 'android' | 'web' | string {
    throw new Error('not implemented — see TZ §6.1, ROADMAP Phase 1');
  }

  isPluginAvailable(_pluginName: string): boolean {
    throw new Error('not implemented — see TZ §6.1, ROADMAP Phase 1');
  }
}
