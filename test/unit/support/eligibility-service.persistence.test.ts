import { describe, expect, it } from 'vitest';
import { EligibilityService } from '../../../src/core/support/eligibility-service.js';
import { FakeDeviceInfoAdapter } from '../../../src/adapters/node-testing/fake-device-info.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { Database } from '../../../src/core/db/database.js';
import type { DeviceSnapshot } from '../../../src/core/support/types.js';

// The stateful wrapper (TZ §6.2-§6.4): live DeviceInfoPort snapshot +
// kv_store-persisted LocalRuntimeVerdicts. `evaluateEligibility()` itself is
// covered exhaustively in eligibility-service.test.ts — this suite only
// exercises the I/O/persistence layer around it.

const artifact = { id: 'qwen-4b', version: 1, minRamGb: 4, recommendedRamGb: 8, sizeBytes: 2_500_000_000 };

const goodDevice: DeviceSnapshot = {
  totalRamGb: 8,
  freeRamGb: 6,
  freeDiskBytes: 10_000_000_000,
  thermal: 'nominal',
  lowPowerMode: false,
};

async function makeService() {
  const sqlite = new NodeSqliteAdapter(':memory:');
  await new Database(sqlite, new FakeClockAdapter()).migrate();
  const deviceInfo = new FakeDeviceInfoAdapter(goodDevice);
  const service = new EligibilityService(deviceInfo, sqlite, new FakeClockAdapter());
  return { service, deviceInfo, sqlite };
}

describe('EligibilityService', () => {
  it('evaluates "unknown" with a reason when device-info is unavailable', async () => {
    const { service, deviceInfo } = await makeService();
    deviceInfo.set(null);

    const report = await service.evaluate(artifact);

    expect(report.verdict).toBe('unknown');
    expect(report.device).toBeNull();
    expect(report.reasons).toEqual(['device-info unavailable — eligibility cannot be determined']);
  });

  it('evaluates "ok" with an explanatory reason on a comfortable device', async () => {
    const { service } = await makeService();
    const report = await service.evaluate(artifact);
    expect(report.verdict).toBe('ok');
    expect(report.reasons).toEqual(['device comfortably exceeds every threshold']);
  });

  it('recordVerdict("oom") persists and downgrades the next evaluate() to "no"', async () => {
    const { service } = await makeService();

    await service.recordVerdict(artifact.id, artifact.version, 'oom');
    const report = await service.evaluate(artifact);

    expect(report.verdict).toBe('no');
    expect(report.reasons).toContain('a previous load attempt on this device ran out of memory');
  });

  it('recordVerdict("tooSlow") persists and downgrades the next evaluate() to "tight"', async () => {
    const { service } = await makeService();

    await service.recordVerdict(artifact.id, artifact.version, 'tooSlow');
    const report = await service.evaluate(artifact);

    expect(report.verdict).toBe('tight');
    expect(report.reasons).toContain('a previous bench on this device was below the tooSlow threshold');
  });

  it('resetLocalVerdicts() clears a persisted verdict, restoring the snapshot-only result', async () => {
    const { service } = await makeService();
    await service.recordVerdict(artifact.id, artifact.version, 'oom');

    await service.resetLocalVerdicts();
    const report = await service.evaluate(artifact);

    expect(report.verdict).toBe('ok');
  });

  it('a verdict recorded for one artifact version does not affect a different version', async () => {
    const { service } = await makeService();
    await service.recordVerdict(artifact.id, 1, 'oom');

    const report = await service.evaluate({ ...artifact, version: 2 });

    expect(report.verdict).toBe('ok');
  });
});
