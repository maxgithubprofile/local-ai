import type { DeviceInfoPort } from '../../core/ports/device-info.port.js';
import type { DeviceSnapshot } from '../../core/support/types.js';

/**
 * Not implemented — Phase 1 (ROADMAP.md). Returns a fixed/injectable
 * {@link DeviceSnapshot} (or `null`, to exercise the soft-dependency path)
 * for `evaluateEligibility()`'s boundary tests — TZ §13.1.
 */
export class FakeDeviceInfoAdapter implements DeviceInfoPort {
  async getSnapshot(): Promise<DeviceSnapshot | null> {
    throw new Error('not implemented — see TZ §6.2, §13.1, ROADMAP Phase 1');
  }
}
