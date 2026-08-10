import { Capacitor } from '@capacitor/core';
import type { PlatformSupportPort } from '../../core/ports/platform-support.port.js';

/**
 * Thin wrapper over `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()`
 * / `Capacitor.isPluginAvailable()` (official Capacitor core API, TZ §6.1) —
 * nothing bespoke. Requires `@capacitor/core` as a peer dependency.
 */
export class CapacitorPlatformSupportAdapter implements PlatformSupportPort {
  isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  getPlatform(): 'ios' | 'android' | 'web' | string {
    return Capacitor.getPlatform();
  }

  isPluginAvailable(pluginName: string): boolean {
    return Capacitor.isPluginAvailable(pluginName);
  }
}
