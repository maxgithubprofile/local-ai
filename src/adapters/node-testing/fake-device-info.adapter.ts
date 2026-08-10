import type { DeviceInfoPort } from '../../core/ports/device-info.port.js';
import type { DeviceSnapshot } from '../../core/support/types.js';

/**
 * Returns a fixed/injectable {@link DeviceSnapshot} (or `null`, to exercise
 * the soft-dependency path) for `EligibilityService`'s tests — TZ §13.1.
 * Mutable via {@link FakeDeviceInfoAdapter.set} so a single instance can
 * simulate a device's RAM/thermal state changing between calls.
 */
export class FakeDeviceInfoAdapter implements DeviceInfoPort {
  constructor(private snapshot: DeviceSnapshot | null = null) {}

  async getSnapshot(): Promise<DeviceSnapshot | null> {
    return this.snapshot;
  }

  /** Replaces the snapshot returned by subsequent {@link getSnapshot} calls. */
  set(snapshot: DeviceSnapshot | null): void {
    this.snapshot = snapshot;
  }
}
