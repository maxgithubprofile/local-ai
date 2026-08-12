# Support and eligibility checks

TZ §6 splits two questions that sound similar but are answered completely differently:

| | `checkSupport()` | `checkDeviceEligibility()` |
|---|---|---|
| Question | Can this **build** run `local-ai` at all? | Is **this device, right now** up to **this specific model**? |
| Changes between runs on the same device? | No — depends on which native plugins were compiled in | Yes — RAM/disk/thermal state changes moment to moment |
| Needs `manifestUrl`/network? | No | No (uses whatever manifest is already cached — call `refreshManifest()` first if none is) |
| Can throw? | No — returns a report | `checkDeviceEligibility()` itself never throws; `ensureModelReady()`/`ensureEmbeddingReady()` may throw `DeviceNotEligibleError` depending on `eligibilityPolicy` |

## `checkSupport()`

```ts
const support = await LocalAiClient.checkSupport({ platformSupport });
// support.platform: 'ios' | 'android' | 'web' | 'unknown'
// support.capabilities: { inference, sql, vectorSearch, download, deviceInfo } — each independently true/false
// support.missingPlugins: [{ capability, pluginName, required }]
// support.reasons: human-readable strings for logs/UI
```

`inference` requires both a native platform *and* the `LlamaCpp` plugin registered — it's `false`
unconditionally on web, regardless of what else is installed. `sql`/`vectorSearch` can stay `true` on
web if `@capacitor-community/sqlite`'s web fallback (`jeep-sqlite`) is set up — `download` and
`deviceInfo` cannot, their underlying plugins are native-only. `deviceInfo: false` doesn't block
anything else — it just means `checkDeviceEligibility()` degrades to `verdict: 'unknown'` instead of a
real answer (a soft dependency, TZ §4.5).

## `checkDeviceEligibility(target?)`

```ts
const report = await client.checkDeviceEligibility('model'); // or 'embedding', default 'model'
// report.verdict: 'ok' | 'tight' | 'no' | 'unknown'
// report.reasons: which threshold(s) actually fired
// report.device: the raw DeviceSnapshot, or null if deviceInfo is unavailable
```

The verdict comes from a pure function (`evaluateEligibility`, exported from `local-ai` for your own
testing/simulation) applied to the manifest artifact's `minRamGb`/`recommendedRamGb`/`sizeBytes`
against a live device snapshot, plus any locally-cached `LocalRuntimeVerdict` (`'tooSlow'`/`'oom'`)
from a *previous real attempt* on this device — see TZ §6.2 for the exact threshold table and §6.3 for
how those local verdicts get recorded and cleared (`client.resetLocalVerdicts()`).

## `eligibilityPolicy`

```ts
const client = await LocalAiClient.create({
  manifestUrl,
  ports,
  eligibilityPolicy: {
    no: 'block',    // default — ensureModelReady()/ensureEmbeddingReady() throw DeviceNotEligibleError
    tight: 'warn',  // default — emits 'device:eligibility-warning', generation proceeds
  },
});

client.on('device:eligibility-warning', (report) => {
  showLowMemoryBanner(report.reasons);
});
```

Each verdict (`'no'`, `'tight'`/`'unknown'` share one policy slot) independently accepts
`'block' | 'warn' | 'ignore'`. `'ignore'` means that verdict is never acted on by
`ensureModelReady()`/`ensureEmbeddingReady()` at all (no throw, no event) — `checkDeviceEligibility()`
itself remains callable and honest regardless of policy, for a manual "are we sure?" check in your own
UI.

## Calibrated thresholds — help wanted

TZ §6.2's `minRamGb ≈ ceil(sizeGB × 1.5)` / `recommendedRamGb ≈ ceil(sizeGB × 2.5)` formula (and the
`tooSlowTokPerSec: 3` default) is explicitly a **starting point, not measured data** — nobody has run
these models on real hardware across a RAM spread yet (no device was available while building this
library; same residual risk as every `proposed` Phase 0 ADR). `minRamGb`/`recommendedRamGb` live in
the **manifest**, not in library code (TZ §6.2's closing note) — so the fix for a bad number is editing
your catalog, not a library release. This table is where calibrated numbers should land once someone
runs the numbers on real devices; empty for now.

| Model (quant) | File size | Device tested | `minRamGb` (measured) | `recommendedRamGb` (measured) | Measured tok/s | Notes |
|---|---|---|---|---|---|---|
| _(none yet — see `docs/pre-release-checklist.md`'s device-dependent section, FB.7)_ | | | | | | |

If you calibrate real numbers for a model you use, consider contributing a row back here (or, if this
becomes a published package, into the default manifest's `minRamGb`/`recommendedRamGb` fields
directly) so the next consumer doesn't have to repeat the same benchmarking from zero.
