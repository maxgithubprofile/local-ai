import { Capacitor, registerPlugin } from '@capacitor/core';
import type { DeviceInfoPort } from '../../core/ports/device-info.port.js';
import type { DeviceSnapshot } from '../../core/support/types.js';

/** Minimal slice of `@capgo/capacitor-device-info`'s real plugin surface this adapter uses (ADR 0004). */
interface DeviceInfoPlugin {
  getInfo(): Promise<{
    memory: { totalBytes?: number; freeBytes?: number };
    storage: { freeBytes?: number };
    thermalState?: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
    lowPowerMode?: boolean;
  }>;
}

/** Registration name confirmed in `docs/adr/0005-native-plugin-name-constants.md`. */
const DeviceInfo = registerPlugin<DeviceInfoPlugin>('DeviceInfo');

/**
 * Wraps `@capgo/capacitor-device-info` (TZ §4.5) — `getInfo()` for
 * RAM/thermal/low-power-mode. Soft dependency: if the plugin isn't
 * installed/available on this platform, `getSnapshot()` resolves `null`,
 * never throws — `EligibilityService` relies on that to degrade to verdict
 * `'unknown'` (TZ §6.2). Field mapping confirmed in
 * `docs/adr/0004-capgo-device-info.md`; real-device accuracy of the
 * numbers is unverified (no device in this environment).
 */
export class CapgoDeviceInfoAdapter implements DeviceInfoPort {
  async getSnapshot(): Promise<DeviceSnapshot | null> {
    if (!Capacitor.isPluginAvailable('DeviceInfo')) return null;
    const info = await DeviceInfo.getInfo();
    return {
      totalRamGb: (info.memory.totalBytes ?? 0) / 1e9,
      freeRamGb: (info.memory.freeBytes ?? 0) / 1e9,
      freeDiskBytes: info.storage.freeBytes ?? 0,
      thermal: info.thermalState ?? 'unknown',
      lowPowerMode: info.lowPowerMode,
    };
  }
}
