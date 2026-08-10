# 0004. `@capgo/capacitor-device-info` field accuracy (Phase 0 spike 0.4)

**Status:** proposed (API shape confirmed from source; real-device accuracy of RAM/thermal
readings unconfirmed — no physical Android/iOS device available in this environment)
**Date:** 2026-08-10
**TZ section(s):** §4.5, §6.2, §16.15

## Context

`@capgo/capacitor-device-info@8.0.10` installed; `dist/esm/definitions.d.ts` read directly. Confirmed
real shape (fully typed, `@since 8.0.0` on every field — this is a mature, documented API, not a
README-only claim):

```ts
getInfo(): Promise<DeviceInfoSnapshot>
// DeviceInfoSnapshot: { timestamp, platform, cpu: CpuInfo, memory: MemoryInfo, storage: StorageInfo,
//   gpu?: GpuInfo, thermalState?: ThermalState, lowPowerMode?: boolean, sensors?: OnboardSensorsInfo }
startMonitoring(options?: { intervalMs?; durationMs?; sampleCount?; emitImmediately? }): Promise<StartMonitoringResult>
stopMonitoring(): Promise<StopMonitoringResult>
isMonitoring(): Promise<MonitoringState>
addListener('deviceInfoUpdate', (event: DeviceInfoUpdate) => void): Promise<PluginListenerHandle>
```

`MemoryInfo.totalBytes`/`freeBytes` are exactly what `DeviceInfoPort.getSnapshot()`'s
`totalRamGb`/`freeRamGb` need (bytes → GB conversion in the adapter). `StorageInfo.freeBytes` maps to
`freeDiskBytes` directly (already bytes, no conversion). `thermalState: ThermalState` is a **literal
match** for `DeviceSnapshot['thermal']`'s type (`'nominal'|'fair'|'serious'|'critical'|'unknown'`) —
no mapping table needed, just a straight pass-through with `?? 'unknown'`. `lowPowerMode: boolean`
passes through directly.

The package's own type docs (not README prose — actual JSDoc on each field, `@since 8.0.0`)
independently confirm TZ §4.5's specific claims:

- "`temperatureCelsius` — Android reads this as a best-effort value from device thermal zones. iOS
  does not expose raw CPU temperature through public APIs." (verbatim on both `CpuInfo` and
  `GpuInfo`) — matches TZ exactly; the library must not treat iOS's absence of this field as an
  error, just an expected `undefined`.
- No `web` implementation directory shipped — `deviceInfo` capability is native-only, matching TZ
  §4.5's "soft-dependency" framing (`DeviceInfoPort.getSnapshot()` returns `null` on web/unavailable,
  `EligibilityService` degrades to `'unknown'`, not a throw).
- Android plugin registration name: `"DeviceInfo"`. iOS `jsName`: `"DeviceInfo"` — matches. Feeds
  ADR 0005.

**Not verifiable from this environment:** whether `totalBytes`/`freeBytes`/`thermalState` are
*accurate* on real hardware (the TZ §6.2 threshold table — 4 GB min / 8 GB recommended for a 4B
Q4_K_M model, `tight` on `thermal === 'critical'` — was calibrated from general industry sources, not
from this plugin's real-device output). No low-end or high-end physical/emulated Android or iOS
device was available to cross-check `getInfo()`'s numbers against, e.g., Android's own Settings app
or Xcode's device diagnostics.

## Decision

Adopt `@capgo/capacitor-device-info@8.0.10`. `CapgoDeviceInfoAdapter` (already scaffolded,
`src/adapters/capacitor/capgo-device-info.adapter.ts`) implements `DeviceInfoPort.getSnapshot()` as:

```ts
async getSnapshot(): Promise<DeviceSnapshot | null> {
  if (!Capacitor.isPluginAvailable('DeviceInfo')) return null;
  const info = await DeviceInfo.getInfo();
  return {
    totalRamGb: (info.memory.totalBytes ?? 0) / 1e9,
    freeRamGb: (info.memory.freeBytes ?? 0) / 1e9,
    freeDiskBytes: info.storage.freeBytes ?? 0,
    thermal: info.thermalState ?? 'unknown',
    lowPowerMode: info.lowPowerMode,
  };
}
```

`totalBytes`/`freeBytes`/`freeBytes` (storage) are `optional` in the real type (not guaranteed by
every platform) — the `?? 0` fallback means a platform that omits memory info produces
`totalRamGb: 0`, which `evaluateEligibility()` already turns into `'no'` (device.totalRamGb <
artifact.minRamGb) rather than a false `'ok'` — a safe fail-closed default given the field is
genuinely absent rather than zero.

TZ §6.2's threshold table (4 GB / 8 GB / 3 tok/s / etc.) is kept as-is — this spike had no device to
recalibrate it against, so there is nothing to change yet. `docs/decisions.md` #15 ("how strictly to
trust iOS thermal/low-power signals") stays open as a product question; the adapter above simply
passes the plugin's own signal through unmodified either way.

## Consequences

- Unblocks ROADMAP Phase 1 (1.3/1.4, `SupportChecker`/`EligibilityService`) and Phase 4's
  eligibility wiring — the mapping above is concrete and the adapter's stub can be replaced directly.
- To move to `accepted`: run `getSnapshot()` on one low-end and one high-end real or emulated Android
  device and one real or simulated iOS device; compare `totalRamGb`/`freeRamGb` against the OS's own
  reported values, and force a thermal-throttling state (or fake it in a simulator) to confirm
  `thermalState` actually changes from `'nominal'`.
- If real-device numbers show the §6.2 thresholds are miscalibrated (e.g. `freeRamGb` reads
  suspiciously low even on a healthy device because Android counts differently than expected), the
  fix is a threshold-table update in the *manifest* (`minRamGb`/`recommendedRamGb` are already
  manifest fields, not hardcoded — §5.2) and/or `tooSlowTokPerSec`/`freeRamGb < minRamGb × 0.5`
  constant tuning in `evaluateEligibility()` — both are isolated, low-risk changes that don't touch
  this adapter.
