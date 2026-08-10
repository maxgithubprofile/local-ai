/**
 * Port for asking the current build/runtime "what platform am I on, and
 * which native plugins does this build actually have registered" —
 * TZ §6.1. Deliberately narrow: no eligibility (RAM/thermal/etc, that is
 * {@link DeviceInfoPort}) and no network access. A production adapter is a
 * thin wrapper over `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()`
 * / `Capacitor.isPluginAvailable()` — nothing bespoke.
 */
export interface PlatformSupportPort {
  /** True on Android/iOS native builds; false on web/Electron. */
  isNativePlatform(): boolean;

  /** Coarse platform id as reported by the host (Capacitor or a fake in tests). */
  getPlatform(): 'ios' | 'android' | 'web' | string;

  /**
   * Whether a native plugin is registered in the current build.
   * `pluginName` is the plugin's registration name (e.g. `'CapacitorSQLite'`)
   * — the exact strings per plugin are confirmed in the Phase 0 spike
   * (TZ §6.1) and centralized as a constant once known, not hardcoded here.
   */
  isPluginAvailable(pluginName: string): boolean;
}
