import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../../../src/core/support/eligibility-service.js';
import type { DeviceSnapshot } from '../../../src/core/support/types.js';

// Boundary cases transcribed from TZ §6.2/§13.1 — the pure function has no
// port dependencies, so this suite needs nothing beyond the function itself.

const artifact = { minRamGb: 4, recommendedRamGb: 8, sizeBytes: 2_500_000_000 };

const baselineDevice: DeviceSnapshot = {
  totalRamGb: 8,
  freeRamGb: 6,
  freeDiskBytes: 10_000_000_000,
  thermal: 'nominal',
  lowPowerMode: false,
};

describe('evaluateEligibility', () => {
  it('returns "unknown" when device info is unavailable (soft dependency, TZ §4.5)', () => {
    expect(evaluateEligibility(artifact, null)).toBe('unknown');
  });

  it('returns "no" on a prior local OOM verdict regardless of the live snapshot', () => {
    expect(evaluateEligibility(artifact, baselineDevice, 'oom')).toBe('no');
  });

  it('returns "no" when totalRamGb is below minRamGb', () => {
    const device: DeviceSnapshot = { ...baselineDevice, totalRamGb: 3.9 };
    expect(evaluateEligibility(artifact, device)).toBe('no');
  });

  it('returns "no" when free disk is below sizeBytes * 1.15', () => {
    const device: DeviceSnapshot = { ...baselineDevice, freeDiskBytes: artifact.sizeBytes };
    expect(evaluateEligibility(artifact, device)).toBe('no');
  });

  it('returns "tight" on a prior local tooSlow verdict', () => {
    expect(evaluateEligibility(artifact, baselineDevice, 'tooSlow')).toBe('tight');
  });

  it('returns "tight" when thermal is critical', () => {
    const device: DeviceSnapshot = { ...baselineDevice, thermal: 'critical' };
    expect(evaluateEligibility(artifact, device)).toBe('tight');
  });

  it('returns "tight" when lowPowerMode is on', () => {
    const device: DeviceSnapshot = { ...baselineDevice, lowPowerMode: true };
    expect(evaluateEligibility(artifact, device)).toBe('tight');
  });

  it('returns "tight" when freeRamGb is below half of minRamGb', () => {
    const device: DeviceSnapshot = { ...baselineDevice, freeRamGb: 1.9 };
    expect(evaluateEligibility(artifact, device)).toBe('tight');
  });

  it('returns "tight" when totalRamGb is below recommendedRamGb', () => {
    const device: DeviceSnapshot = { ...baselineDevice, totalRamGb: 7 };
    expect(evaluateEligibility(artifact, device)).toBe('tight');
  });

  it('returns "ok" when everything is comfortably above every threshold', () => {
    expect(evaluateEligibility(artifact, baselineDevice)).toBe('ok');
  });
});
