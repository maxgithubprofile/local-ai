# 0006. Streaming SHA-256 timing on a ~2.5GB artifact (Phase 0 spike 0.6)

**Status:** proposed (desktop-CPU proxy measurement only — no mid-range Android device available in
this environment; treat the device-relevant number below as an order-of-magnitude estimate, not a
measurement)
**Date:** 2026-08-10
**TZ section(s):** §7.4, §17

## Context

TZ asks specifically for timing on a **mid-range Android device**, which this environment cannot
provide (no physical/emulated Android hardware here). What was done instead: a streaming SHA-256
benchmark on this dev machine's CPU (Intel Core i7-10750H, desktop-class, 2020) hashing a 512 MB
synthetic buffer in 1 MB chunks via Node's `crypto.createHash('sha256')` (the same primitive
`WebCryptoHashAdapter`, task 2.1, wraps) — chosen as a stand-in for `FileSystemPort.readChunks()` +
incremental `HashPort.createSha256()` without needing an actual 2.5GB file on disk.

Result: **346 MB/s**, i.e. a 2.5 GB file extrapolates to **~7 seconds** on this desktop CPU.

This number is **not** the answer TZ needs — a mid-range Android phone's CPU (and its JS/native
bridge overhead, since the real path is Capacitor → native `FileSystemPort.readChunks()` → JS
`HashPort`, not a tight desktop loop) is reasonably expected to be several times slower than a 2020
Intel laptop CPU for single-threaded hashing, plus chunked-read overhead crossing the JS bridge
repeatedly that this benchmark doesn't model at all. Public general-purpose benchmarks for
mid-range ARM mobile SoCs doing SHA-256 commonly land in the tens-to-low-hundreds of MB/s range
depending on whether ARMv8 crypto extensions are used — a mid-range device could plausibly take
**anywhere from ~15 seconds to over a minute** for a 2.5GB file. That range is wide enough to not be
a substitute for a real measurement.

## Decision

Given the honest uncertainty above, **build the progress/UX affordance now rather than wait for a
real number**: `DownloadEngine`'s checksum-verification step (task 2.4, using `checksum.ts` from
2.1a) must report incremental progress (bytes hashed / total bytes) through the same event channel
download progress already uses, not just a binary "verifying…" spinner with no feedback — cheap to
build, and correct regardless of whether the real mid-range number turns out to be 7 seconds or 70.
`HashPort.createSha256()` (already shaped as an incremental hasher, not a single call) supports this
without a port change.

## Consequences

- Unblocks ROADMAP task 2.1a directly (no design change forced) and informs task 2.4's UX contract
  (checksum progress is part of the download UX, not an unannounced pause after 100% download
  progress).
- To move to `accepted`: run the same streaming-hash pattern (1MB chunks, incremental digest) inside
  a real or emulated mid-range Android app, hashing an actual ~2.5GB file written to disk, and record
  wall-clock time. If it lands under ~10s, the progress UI in the decision above is still correct but
  low-stakes; if it's 30s+, that progress UI becomes load-bearing UX, not a nice-to-have — worth
  flagging back to product if so.
- No fallback needed either way — incremental hashing is required regardless of speed (TZ §14's
  mandatory SHA-256-before-load invariant isn't negotiable), this spike only affects UX polish
  around *how* that mandatory step is presented to the user.
