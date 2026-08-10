# 0003. `@capgo/capacitor-downloader` transport (Phase 0 spike 0.3)

**Status:** proposed (desk research only — no device to confirm process-kill survival)
**Date:** 2026-08-10
**TZ section(s):** §4.4, §7.2, §16.13

## Context

`@capgo/capacitor-downloader@8.1.31` installed and its shipped
`dist/esm/definitions.d.ts` read directly (real typed contract, not README). Confirmed real API:

```ts
download(options: { id; url; destination; headers?; network?: 'cellular' | 'wifi-only'; priority?: 'high'|'normal'|'low' }): Promise<DownloadTask>
pause(options: { id }): Promise<void>
resume(options: { id }): Promise<void>
stop(options: { id }): Promise<void>          // cancels AND deletes downloaded data
checkStatus(options: { id }): Promise<DownloadTask>   // { id, progress: 0-100, state: 'PENDING'|'RUNNING'|'PAUSED'|'DONE'|'ERROR' }
getFileInfo(options: { path }): Promise<{ size; type }>
addListener('downloadProgress' | 'downloadCompleted' | 'downloadFailed', ...): Promise<PluginListenerHandle>
```

Confirmed against TZ's claims:

- `network: 'wifi-only'` exists exactly as TZ's wifi-only requirement needs (§7.2).
- Progress is `0–100` integer only, no byte-level progress and no built-in checksum — matches TZ
  §4.4's statement that `sha256` verification stays `local-ai`'s job (already the design:
  `checksum.ts` + `HashPort`, task 2.1a).
- Android plugin registration name: `"CapacitorDownloader"` (`@CapacitorPlugin(name =
  "CapacitorDownloader")`). iOS `jsName`: `"CapacitorDownloader"` (from
  `CapacitorDownloaderPlugin.swift`'s `public let jsName`) — matches Android, as Capacitor requires.
  Feeds ADR 0005.
- No `src/web.ts` in the package — web is unsupported, matching the "download" capability needing to
  report `false` on web for this plugin specifically (per-capability, not blanket, per TZ §6.1).

**Not verifiable from this environment** (needs a real device, ideally with the app force-killed by
the OS mid-download, on both platforms):

1. Whether a `download()` task genuinely survives the *process* being killed (not just backgrounded)
   — the README claims "Downloads continue even when app is minimized, backgrounded, or closed" and
   separately lists "Resumable downloads (pause/resume) — **platform dependent**" as a distinct,
   narrower claim. Those two claims are not obviously the same guarantee; "closed" downloads
   continuing does not by itself guarantee that calling `resume()` after an app cold-start will
   correctly resume a `PAUSED`/interrupted task rather than requiring a fresh `download()` call.
2. The exact resolution rule for `destination` — the type only documents it as "Local file path
   where the download will be saved" (string), no confirmed base-directory semantics (relative to
   app sandbox root? a specific `Documents`/`Library` subfolder? absolute path required?). Untested.
3. Whether an `ERROR` state distinguishes "network dropped, safely resumable" from "corrupted,
   restart from scratch" — `checkStatus()`'s `DownloadTask` shape has no error-reason field, only
   `state: 'ERROR'`; `downloadFailed`'s listener payload has `{ id, error: string }` (a message, not
   a typed reason) — `DownloadEngine`'s retry/backoff logic (task 2.4) cannot branch on failure
   *kind*, only retry generically and re-verify checksum from scratch each time.

## Decision

Adopt `@capgo/capacitor-downloader@8.1.31` as the production transport (`CapgoDownloaderAdapter`,
task 2.6), matching `DownloadTransportPort`'s existing shape. Because process-kill survival and
partial-resume correctness are unconfirmed, `DownloadEngine` (task 2.4) must treat resume as
**best-effort, always re-verified**, never trusted blindly:

- On every app start (or `ensureModelReady()`/`ensureEmbeddingReady()` call), if `download_state`
  (SQL, task 2.5) shows an in-progress download, call `checkStatus()` first rather than assuming the
  native task is still alive; if the native plugin has no record of that `id` (fresh process, task
  lost), fall back to a clean `download()` restart rather than erroring.
- SHA-256 verification (task 2.1a) always runs on the *complete* file regardless of whether the
  download was resumed or fresh — this is already `local-ai`'s design (the plugin does no
  verification itself) and happens to also be the safety net for point 1/3 above: a corrupted resume
  is caught here, not trusted from `state: 'DONE'` alone.
- `destination` is built by `local-ai` itself from `FileSystemPort`'s resolved app-data directory
  (task 2.x, not the plugin) — never pass a bare relative string without resolving it through the
  filesystem port first, precisely because the plugin's own docs don't pin down relative-path
  semantics.

Plugin-name constant: `'CapacitorDownloader'` (feeds ADR 0005).

## Consequences

- Unblocks ROADMAP Phase 2 in full (2.1–2.6) — the port shape and adapter responsibilities above are
  concrete enough to implement without re-deriving from the README.
- `docs/decisions.md` #13 stays formally **Open** (this ADR is `proposed`, not `accepted` — device
  confirmation still pending) but is no longer *blocking*: Phase 2 proceeds using the
  always-re-verify design above, which is safe regardless of how process-kill survival turns out on
  a real device.
- To move to `accepted`: on a real Android and a real iOS device, start a download, force-kill the
  host app process (not just background it), relaunch, and confirm `checkStatus()`/`resume()`
  produces a usable file that still passes SHA-256 — or confirms the always-restart fallback path
  above is exercised safely instead.
- If process-kill survival turns out to be unreliable on one platform, no code change is needed — the
  always-re-verify design already degrades gracefully to "just re-download from scratch more often
  than strictly necessary," which is a UX cost, not a correctness bug.
