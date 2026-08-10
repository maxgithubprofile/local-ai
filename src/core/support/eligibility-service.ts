import type { DeviceSnapshot, EligibilityVerdict, LocalRuntimeVerdict } from './types.js';

/**
 * Pure eligibility decision function — TZ §6.2. Fully specified there, so
 * transcribed verbatim rather than left as a stub: it has no I/O
 * dependencies (no ports), so it's exactly as testable now as it will ever
 * be. `EligibilityService` (below) is the stateful wrapper that feeds this
 * a live `DeviceSnapshot` and persists `LocalRuntimeVerdict`s — that part
 * remains a Phase 1 stub.
 *
 * `device === null` (device-info plugin unavailable, TZ §4.5 soft
 * dependency) always yields `'unknown'`, never a false `'ok'`/`'no'`.
 */
export function evaluateEligibility(
  artifact: { minRamGb: number; recommendedRamGb: number; sizeBytes: number },
  device: DeviceSnapshot | null,
  priorVerdict?: LocalRuntimeVerdict,
): EligibilityVerdict {
  if (device === null) return 'unknown';
  if (priorVerdict === 'oom') return 'no';
  if (device.totalRamGb < artifact.minRamGb) return 'no';
  if (device.freeDiskBytes < artifact.sizeBytes * 1.15) return 'no';
  if (priorVerdict === 'tooSlow') return 'tight';
  if (device.thermal === 'critical') return 'tight';
  if (device.lowPowerMode) return 'tight';
  if (device.freeRamGb < artifact.minRamGb * 0.5) return 'tight';
  if (device.totalRamGb < artifact.recommendedRamGb) return 'tight';
  return 'ok';
}

/**
 * Not implemented — Phase 1 (ROADMAP.md). Wraps {@link evaluateEligibility}
 * with a live `DeviceInfoPort` snapshot and `kv_store`-persisted
 * `LocalRuntimeVerdict`s from real load/bench attempts (TZ §6.3):
 * `tgAvg < tooSlowTokPerSec` after a successful load → `'tooSlow'`; a
 * recognizable OOM-shaped load failure → `'oom'`. Both are local,
 * overridable via `resetLocalVerdicts()`.
 */
export class EligibilityService {
  async evaluate(): Promise<never> {
    throw new Error('not implemented — see TZ §6.2-§6.3, ROADMAP Phase 1');
  }
}
