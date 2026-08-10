/**
 * Types shared by {@link ../support/support-checker.ts} and
 * {@link ../support/eligibility-service.ts} — TZ §6 splits "can this library
 * run here at all" ({@link SupportReport}, checked once per build) from
 * "is this specific device up to this specific model right now"
 * ({@link EligibilityReport}, checked per artifact and can change run to run).
 */

/** One library capability that can be independently supported or not (TZ §6.1). */
export type Capability = 'inference' | 'sql' | 'vectorSearch' | 'download' | 'deviceInfo';

/** Result of {@link LocalAiClient.checkSupport} — platform/plugin availability, TZ §6.1. */
export interface SupportReport {
  platform: 'ios' | 'android' | 'web' | 'unknown';
  isNative: boolean;
  capabilities: Record<Capability, boolean>;
  missingPlugins: Array<{ capability: Capability; pluginName: string; required: boolean }>;
  /** Human-readable reasons for logs/UI. Stable machine-readable codes live on thrown errors, not here. */
  reasons: string[];
}

/** Point-in-time device measurement used for eligibility, TZ §6.2. */
export interface DeviceSnapshot {
  totalRamGb: number;
  freeRamGb: number;
  freeDiskBytes: number;
  thermal?: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
  lowPowerMode?: boolean;
}

/** Outcome of `evaluateEligibility()`, TZ §6.2. */
export type EligibilityVerdict = 'ok' | 'tight' | 'no' | 'unknown';

/**
 * Locally observed runtime outcome after an actual load/bench attempt
 * (not derivable from a static device snapshot), TZ §6.3. Cached per
 * `(artifactId, version)` in `kv_store` and overrides a purely
 * snapshot-based verdict.
 */
export type LocalRuntimeVerdict = 'tooSlow' | 'oom';

/** Result of {@link LocalAiClient.checkDeviceEligibility}, TZ §6.4. */
export interface EligibilityReport {
  verdict: EligibilityVerdict;
  reasons: string[];
  device: DeviceSnapshot | null;
}
