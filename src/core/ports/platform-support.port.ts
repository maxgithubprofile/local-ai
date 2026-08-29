/**
 * Port for asking the current build/runtime "what platform am I on, and
 * which native plugins does this build actually have registered" —
 * TZ §6.1. Deliberately narrow: no eligibility (RAM/thermal/etc, that is
 * {@link DeviceInfoPort}) and no network access. A production adapter is a
 * thin wrapper over `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()`
 * / `Capacitor.isPluginAvailable()` — nothing bespoke.
 */
export interface PlatformSupportPort {
  /**
   * True on Android/iOS native builds **and** on Electron's main process
   * (TZ v6 §6.1, `docs/decisions.md` #4 — Electron is a first-class,
   * non-degraded platform, not a web-style degradation); false only on
   * browser web (non-Electron).
   */
  isNativePlatform(): boolean;

  /** Coarse platform id as reported by the host (Capacitor, an Electron adapter, or a fake in tests). */
  getPlatform(): 'ios' | 'android' | 'web' | 'electron' | string;

  /**
   * Whether a native plugin is registered in the current build.
   * `pluginName` is the plugin's registration name (e.g. `'CapacitorSQLite'`)
   * — the exact strings per plugin are confirmed in the Phase 0 spike
   * (TZ §6.1) and centralized as a constant once known, not hardcoded here.
   * On Electron this has no Capacitor plugin registry to check against —
   * `ElectronPlatformSupportAdapter` maps each capability to its own
   * real-availability check instead (e.g. `inference` resolves via
   * `llama-cpp-pro/desktop`'s `assertSidecarBinary()`, not a registry lookup).
   */
  isPluginAvailable(pluginName: string): boolean;
}
