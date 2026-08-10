import type { DeviceSnapshot } from '../support/types.js';

/**
 * Port for reading a point-in-time device snapshot used by
 * {@link EligibilityService} — TZ §4.5, §6.2. This is a **soft dependency**:
 * a `null` return means "device-info isn't available on this
 * platform/build", not an error — callers must degrade to
 * `EligibilityVerdict: 'unknown'`, never throw.
 */
export interface DeviceInfoPort {
  /** Resolves `null` if the underlying plugin is unavailable/unsupported. */
  getSnapshot(): Promise<DeviceSnapshot | null>;
}
