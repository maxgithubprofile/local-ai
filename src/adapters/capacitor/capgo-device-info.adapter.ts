import type { DeviceInfoPort } from '../../core/ports/device-info.port.js';
import type { DeviceSnapshot } from '../../core/support/types.js';

/**
 * Not implemented — Phase 4 (ROADMAP.md). Wraps `@capgo/capacitor-device-info`
 * (TZ §4.5) — `getInfo()`/`startMonitoring()` for RAM/thermal/low-power-mode.
 * Soft dependency: if the plugin isn't installed/available on this platform,
 * `getSnapshot()` must resolve `null`, never throw — `EligibilityService`
 * relies on that to degrade to verdict `'unknown'` (TZ §6.2).
 */
export class CapgoDeviceInfoAdapter implements DeviceInfoPort {
  async getSnapshot(): Promise<DeviceSnapshot | null> {
    throw new Error('not implemented — see TZ §4.5, §6.2, ROADMAP Phase 4');
  }
}
