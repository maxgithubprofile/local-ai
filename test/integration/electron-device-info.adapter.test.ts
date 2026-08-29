import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { ElectronDeviceInfoAdapter } from '../../src/adapters/electron/electron-device-info.adapter.js';

/**
 * Real `os`/`fs.promises.statfs()` calls, no mocking — per CLAUDE.md's
 * testing rule this needs no phone (plain Node APIs, always reachable in
 * CI), so it's an integration test asserting plausible values rather than
 * a device-e2e test, same treatment ELEC.1.5 calls for.
 */
describe('ElectronDeviceInfoAdapter', () => {
  it('getSnapshot() returns plausible non-zero totalRamGb/freeRamGb and a real freeDiskBytes, never null, never throws', async () => {
    const adapter = new ElectronDeviceInfoAdapter(process.cwd());

    const snapshot = await adapter.getSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.totalRamGb).toBeGreaterThan(0);
    expect(snapshot!.totalRamGb).toBeCloseTo(os.totalmem() / 1e9, 6);
    expect(snapshot!.freeRamGb).toBeGreaterThan(0);
    expect(snapshot!.freeRamGb).toBeLessThanOrEqual(snapshot!.totalRamGb);
    expect(snapshot!.freeDiskBytes).toBeGreaterThan(0);
  });

  it("reports thermal/lowPowerMode as the honest 'no desktop signal' fallback (ADR 0009) rather than a fabricated value", async () => {
    const adapter = new ElectronDeviceInfoAdapter(process.cwd());

    const snapshot = await adapter.getSnapshot();

    expect(snapshot!.thermal).toBe('unknown');
    expect(snapshot!.lowPowerMode).toBeUndefined();
  });

  it('walks up to an existing ancestor directory for freeDiskBytes when given a non-existent path, same as NodeFsAdapter.freeSpaceBytes()', async () => {
    const path = await import('node:path');
    const adapter = new ElectronDeviceInfoAdapter(path.join(process.cwd(), 'this-directory-does-not-exist'));

    const snapshot = await adapter.getSnapshot();

    expect(snapshot!.freeDiskBytes).toBeGreaterThan(0);
  });
});
