# 0009. Desktop device-info source (Phase 0 spike ELEC.0.2)

**Status:** accepted (Windows: physically run in this environment and returned plausible values;
macOS/Linux: `os`/`fs.promises.statfs` are documented cross-platform Node APIs, not physically
verified on those OSes here — same "accepted on the verified OS, residual risk on the others"
posture ADR 0001/0005 already use for a single-platform confirmation)
**Date:** 2026-08-29
**TZ section(s):** v6 §6.1 (Electron), §6.2, ledger row #22

## Context

`ROADMAP.md`'s ELEC.0.2 asked whether `os.totalmem()`/`os.freemem()`/`fs.promises.statfs()` are
accurate/available cross-platform, as an alternative to pulling in a dependency like
`systeminformation`.

**Ran directly in this environment** (`node --version` → v22.12.0, win32/x64, real hardware, not
mocked):

```
totalmem: 34189754368  (34.19GB)
freemem:  11030532096  (11.03GB)
typeof fs.promises.statfs: function
statfs('C:\\'): { bsize: 4096, blocks: 249759457, bfree: 17643746, bavail: 17643746, ... }
→ bavail * bsize = 72268783616 bytes free disk
```

All three return plausible non-zero numbers on real Windows/Node 22. This also cross-checks against
`NodeFsAdapter.freeSpaceBytes()` (`src/adapters/node-testing/node-fs.adapter.ts:96-109`), which
already computes free disk space as `statfs(target).bavail * bsize` for SEC.3 — the exact same call
this spike just confirmed works, so `ElectronDeviceInfoAdapter`/`ElectronFsAdapter` can reuse that
adapter's `freeSpaceBytes()` unmodified rather than reimplementing it (see ELEC.1.1b's existing plan
to re-export `NodeFsAdapter` as-is; this spike is direct evidence that plan is sound, not just
theoretically expected to work).

**Real correction found, not assumed** — reading `llama-cpp-pro`'s own installed desktop sources
(`node_modules/llama-cpp-pro/desktop/src/main/ipc-handlers.cjs:29-68`, `getAvailableSystemBytes()`),
the plugin this library already depends on for inference explicitly does **not** trust
`os.freemem()` on macOS:

```
/**
 * macOS `os.freemem()` only counts truly free pages and is usually tiny while
 * inactive/purgeable pages are reclaimable. Prefer an "available" estimate so
 * model admission does not falsely reject on Darwin.
 */
```

On Darwin it shells out to `vm_stat` and sums `Pages free + inactive + speculative + purgeable`
(all reclaimable-but-not-literally-free pages macOS's page cache holds onto); as a secondary
fallback (non-Darwin, or if `vm_stat` fails) it compares `os.freemem()` against Electron/Chromium's
own `process.getSystemMemoryInfo()` (KB) and takes whichever is larger. This function is **not**
exported from `llama-cpp-pro/desktop`'s public API (`desktop/src/main/index.cjs`'s `module.exports`
— confirmed by reading it directly, only `getModelsDir`/`getSettingsDir`/probe/backend/sidecar
helpers are exported) — it's only reachable indirectly via `registerLlamaDesktopIpc()`'s
renderer-facing `CHANNEL_MEMORY` IPC handler, which `local-ai`'s main-process-only `DeviceInfoPort`
has no reason to route through.

**Not verifiable from this environment:** the macOS `vm_stat` behavior itself (no macOS machine
available), and Linux's `os.freemem()`/`statfs()` accuracy (no Linux machine available) — same
residual-risk shape as every other OS-specific claim in this ROADMAP's Electron section.

## Decision

`ElectronDeviceInfoAdapter` (`src/adapters/electron/electron-device-info.adapter.ts`, ELEC.1.3)
implements `DeviceInfoPort.getSnapshot()` as:

```ts
totalRamGb: os.totalmem() / 1e9,
freeRamGb: getAvailableSystemBytes(os.totalmem()) / 1e9,  // NOT bare os.freemem()
freeDiskBytes: await freeSpaceBytes(app.getPath('userData')),  // reuse NodeFsAdapter's statfs logic
thermal: 'unknown',      // no desktop-native equivalent, see below
lowPowerMode: undefined, // no desktop-native equivalent, see below
```

`getAvailableSystemBytes()` is reimplemented in `local-ai`'s own adapter (small, ~20 lines,
`execSync('vm_stat')` on `darwin`, `process.getSystemMemoryInfo()` cross-check otherwise, `os.freemem()`
floor) rather than imported — `llama-cpp-pro/desktop` doesn't export it, and depending on an
unexported internal of a peer dependency would break silently on its next minor version. Duplicating
~20 lines of a peer's already-shipped, purpose-built logic is preferable to either (a) naively using
`os.freemem()` and inheriting the exact false-eligibility-rejection bug this comment describes, or
(b) inventing a different formula from scratch when a working one already exists one dependency away
— this mirrors CLAUDE.md's "read the source, don't reinvent" spirit.

`thermal`/`lowPowerMode` stay `'unknown'`/`undefined` (both already valid per the port's optional/
union-with-`'unknown'` fields, ADR 0004's mobile adapter uses the same fallback shape) — no OS-level
"thermal throttling" or "low power mode" signal exists for a desktop process the way iOS exposes one;
inventing a synthetic desktop equivalent (e.g. treating high CPU-usage sustained over N seconds as
"thermal") was considered and rejected as fabricating a signal the OS itself doesn't provide, which
would be worse than an honest `'unknown'`.

`freeDiskBytes` is computed by reusing `NodeFsAdapter.freeSpaceBytes(app.getPath('userData'))`
directly (already real, working, spike-confirmed above) rather than a new implementation — same
"re-export don't duplicate" call ELEC.1.1b already planned for `FilesystemPort` generally.

## Consequences

- Unblocks ELEC.1.3 (`ElectronDeviceInfoAdapter`) with a concrete, source-verified implementation —
  no longer a placeholder.
- **Corrects** ELEC.0.2's own original framing in `ROADMAP.md` ("Node's built-in `os.totalmem()`/
  `os.freemem()` ... are the obvious first choice") — `os.freemem()` specifically is the wrong choice
  on macOS and should not ship as-is; `ROADMAP.md`'s ELEC.1.3 task text should be read as superseded
  by this ADR's `getAvailableSystemBytes()`-based decision.
- Resolves ledger row #22's "what raw numbers are available to calibrate against" half (Windows:
  real numbers now confirmed reachable and plausible); the calibration itself (ELEC.3.2, what
  `minRamGb`/`recommendedRamGb` should actually be) still needs real desktop hardware across a RAM
  spread and stays open.
- If macOS's `vm_stat` output format ever changes (unlikely — it's a decades-stable BSD tool) or a
  future `llama-cpp-pro` version changes `getAvailableSystemBytes()`'s own formula, re-diff this
  adapter's copy against the installed package's `ipc-handlers.cjs` before assuming they're still in
  sync — there is no automated check tying the two together, a deliberate accepted risk given the
  function isn't exported for `local-ai` to depend on directly.
