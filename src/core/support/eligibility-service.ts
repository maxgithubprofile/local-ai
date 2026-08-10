import type { DeviceInfoPort } from '../ports/device-info.port.js';
import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { DeviceSnapshot, EligibilityReport, EligibilityVerdict, LocalRuntimeVerdict } from './types.js';

/**
 * Pure eligibility decision function — TZ §6.2. Fully specified there, so
 * transcribed verbatim rather than left as a stub: it has no I/O
 * dependencies (no ports), so it's exactly as testable now as it will ever
 * be. `EligibilityService` (below) is the stateful wrapper that feeds this
 * a live `DeviceSnapshot` and persists `LocalRuntimeVerdict`s.
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
 * Human-readable reasons for a verdict — presentational only, never
 * consulted by {@link evaluateEligibility} itself. Re-derives which
 * threshold(s) actually fired so `EligibilityReport.reasons` (TZ §6.4) says
 * something more useful than the bare verdict string.
 */
function explainEligibility(
  artifact: { minRamGb: number; recommendedRamGb: number; sizeBytes: number },
  device: DeviceSnapshot | null,
  priorVerdict: LocalRuntimeVerdict | undefined,
  verdict: EligibilityVerdict,
): string[] {
  if (device === null) return ['device-info unavailable — eligibility cannot be determined'];
  const reasons: string[] = [];
  if (priorVerdict === 'oom') reasons.push('a previous load attempt on this device ran out of memory');
  if (priorVerdict === 'tooSlow') reasons.push('a previous bench on this device was below the tooSlow threshold');
  if (device.totalRamGb < artifact.minRamGb) {
    reasons.push(`totalRamGb ${device.totalRamGb} is below minRamGb ${artifact.minRamGb}`);
  }
  if (device.freeDiskBytes < artifact.sizeBytes * 1.15) {
    reasons.push(`freeDiskBytes ${device.freeDiskBytes} is below required ${Math.ceil(artifact.sizeBytes * 1.15)}`);
  }
  if (device.thermal === 'critical') reasons.push('thermal state is critical');
  if (device.lowPowerMode) reasons.push('low-power mode is on');
  if (device.freeRamGb < artifact.minRamGb * 0.5) {
    reasons.push(`freeRamGb ${device.freeRamGb} is below half of minRamGb (${artifact.minRamGb * 0.5})`);
  }
  if (device.totalRamGb < artifact.recommendedRamGb) {
    reasons.push(`totalRamGb ${device.totalRamGb} is below recommendedRamGb ${artifact.recommendedRamGb}`);
  }
  if (reasons.length === 0 && verdict === 'ok') reasons.push('device comfortably exceeds every threshold');
  return reasons;
}

function verdictKvKey(artifactId: string, version: number): string {
  return `eligibility:localVerdict:${artifactId}:${version}`;
}

/**
 * Wraps {@link evaluateEligibility} with a live `DeviceInfoPort` snapshot and
 * `kv_store`-persisted `LocalRuntimeVerdict`s from real load/bench attempts
 * (TZ §6.3): `tgAvg < tooSlowTokPerSec` after a successful load →
 * `'tooSlow'`; a recognizable OOM-shaped load failure → `'oom'`. Both are
 * local and overridable via {@link resetLocalVerdicts}.
 */
export class EligibilityService {
  constructor(
    private readonly deviceInfo: DeviceInfoPort,
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
  ) {}

  /** TZ §6.4 — evaluates a specific artifact against the current device snapshot + any locally cached verdict. */
  async evaluate(artifact: {
    id: string;
    version: number;
    minRamGb: number;
    recommendedRamGb: number;
    sizeBytes: number;
  }): Promise<EligibilityReport> {
    const device = await this.deviceInfo.getSnapshot();
    const priorVerdict = await this.getLocalVerdict(artifact.id, artifact.version);
    const verdict = evaluateEligibility(artifact, device, priorVerdict);
    const reasons = explainEligibility(artifact, device, priorVerdict, verdict);
    return { verdict, reasons, device };
  }

  /** Persists a `LocalRuntimeVerdict` observed from a real load/bench attempt (TZ §6.3). */
  async recordVerdict(artifactId: string, version: number, verdict: LocalRuntimeVerdict): Promise<void> {
    const key = verdictKvKey(artifactId, version);
    await this.sqlite.execute(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify({ verdict }), this.clock.nowIso()],
    );
  }

  /** TZ §6.3 — clears every locally cached `LocalRuntimeVerdict` (e.g. after the user frees device memory). */
  async resetLocalVerdicts(): Promise<void> {
    await this.sqlite.execute("DELETE FROM kv_store WHERE key LIKE 'eligibility:localVerdict:%'");
  }

  private async getLocalVerdict(artifactId: string, version: number): Promise<LocalRuntimeVerdict | undefined> {
    const rows = await this.sqlite.query<{ value: string }>('SELECT value FROM kv_store WHERE key = ?', [
      verdictKvKey(artifactId, version),
    ]);
    if (!rows[0]) return undefined;
    const parsed = JSON.parse(rows[0].value) as { verdict: LocalRuntimeVerdict };
    return parsed.verdict;
  }
}
