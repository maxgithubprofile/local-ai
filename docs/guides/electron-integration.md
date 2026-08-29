# Electron integration

Electron (Windows/macOS/Linux) is a first-class, non-degraded target as of 2026-08-29
(`docs/decisions.md` #4) — not a "runs some capabilities" degradation the way browser web is. See
`ROADMAP.md`'s "Electron desktop support" section for the full task breakdown and
`docs/adr/0009`/`0010`/`0011` for the spikes this guide's advice is based on.

## Main process only

Import `local-ai/adapters/electron` **only from your app's main process**. There's no direct native/
filesystem access from the renderer without your own `contextBridge`/IPC layer — the same split
Capacitor's WebView draws, and equally not `local-ai`'s concern to build for you (TZ §6.1). If your UI
lives in the renderer, expose whatever subset of `LocalAiClient`'s methods your app needs (e.g.
`sendMessage`, download-progress events) through your own `ipcMain.handle`/`contextBridge.exposeInMainWorld`
calls. `ELEC.4.1`'s example app has an illustrative, non-prescriptive sample.

## Install

```bash
npm install local-ai electron llama-cpp-pro
```

`electron` and `llama-cpp-pro` are both `peerDependencies` with `peerDependenciesMeta.optional: true` —
a consumer not targeting Electron isn't forced to install either.

## Assemble the ports

```ts
import { app, BrowserWindow } from 'electron';
import { LocalAiClient } from 'local-ai';
import {
  ElectronPlatformSupportAdapter,
  ElectronDeviceInfoAdapter,
  ElectronAppLifecycleAdapter,
  ElectronFsAdapter,
  ElectronSqliteAdapter,
  ElectronRangeDownloadAdapter,
  LlamaCppProDesktopAdapter,
  WebCryptoHashAdapter,
  SystemClockAdapter,
} from 'local-ai/adapters/electron';
import * as desktop from 'llama-cpp-pro/desktop';

const dataDir = app.getPath('userData');

const ports = {
  platformSupport: new ElectronPlatformSupportAdapter(app, desktop),
  deviceInfo: new ElectronDeviceInfoAdapter(dataDir),
  appLifecycle: new ElectronAppLifecycleAdapter(
    app,
    BrowserWindow,
    () => client.releaseRuntime(), // best-effort, fired on 'before-quit' — see docs/adr/0010
  ),
  fileSystem: new ElectronFsAdapter(dataDir),
  sqlite: new ElectronSqliteAdapter(`${dataDir}/local-ai.db`),
  downloadTransport: new ElectronRangeDownloadAdapter(),
  hash: new WebCryptoHashAdapter(),
  clock: new SystemClockAdapter(),
  llmRuntime: new LlamaCppProDesktopAdapter(desktop),
};
```

`client` is referenced inside `ports` for illustration only; in real code, build `ports` first, then
`client = await LocalAiClient.create({ manifestUrl, ports })`, then wire `onBeforeQuit` to the resulting
`client` (e.g. via a mutable outer variable, or by registering the lifecycle adapter after `create()`).

Every port above is real, implemented, and tested — `SqlitePort`/`FilesystemPort`/`DownloadTransportPort`
are the exact same `NodeFsAdapter`/`NodeSqliteAdapter`/`NodeRangeDownloadAdapter` classes
`local-ai/adapters/node-testing` already uses (re-exported, not duplicated, per `ROADMAP.md`'s
ELEC.1.1b), since Electron's main process is plain Node with no native plugin gate for any of those
three ports. `LlamaCppProDesktopAdapter` was confirmed working end-to-end in this repo's own dev
environment against a real sidecar binary and a real GGUF model
(`docs/adr/0011-electron-sidecar-build.md`'s "Resolution" section).

## Inference — real, with two caveats

`LlamaCppProDesktopAdapter` wraps `llama-cpp-pro/desktop`'s sidecar process for real — real per-token
streaming (`docs/adr/0012-electron-sidecar-streaming.md`), real embeddings, real load/unload. Two things
worth knowing before you rely on it:

1. **A built sidecar binary must actually be present** wherever the app runs. `llama-cpp-pro` ships the
   sidecar's C++ **source**, not prebuilt binaries — building it (`build-variants.sh --variant desktop`)
   needs a real toolchain and, on MSVC specifically, the fixes `docs/adr/0011-electron-sidecar-build.md`'s
   "Resolution" section documents in full (a small, precise CMake-level recipe — no source-file
   patching required except one missing `#include`). If the binary genuinely isn't there,
   `checkSupport().capabilities.inference` reports `false` (a real `assertSidecarBinary()` check, not a
   hardcoded flag) rather than `sendMessage()` failing with a confusing error.
2. **No session-cache speedup, no fine-grained sampling control.** The sidecar's HTTP API has no
   KV-cache persistence endpoint (TZ §9.3's "second response is faster" doesn't hold here) and no
   `topP`/`topK`/`seed`/`stop`/`repeatPenalty` fields (silently ignored on Electron specifically) — both
   documented in `docs/adr/0012-electron-sidecar-streaming.md`, ledger rows #26/#27. `countTokens()`
   also falls back to a chars/4 heuristic (row #25) rather than the sidecar's real tokenizer, since no
   HTTP tokenize endpoint exists either.

Do **not** substitute `node-llama-cpp`/`NodeLlamaCppAdapter` as a stand-in `llmRuntime` for a real
Electron build — it's a Node-side test tool only (TZ §13.1), never validated as a production path here,
and an earlier draft of this project's own Electron planning made exactly that mistake before being
corrected (`docs/decisions.md`'s "Electron desktop support" entry). It's fine to use in your own
Electron app's *tests*, the same way `local-ai`'s own test suite uses it.

## Desktop-scale models

No manifest change is needed for "desktop machines can usually run bigger models" — `EligibilityService`
already filters `models[]`/`embeddings[]` by real device RAM (TZ §6.2), and Electron's
`ElectronDeviceInfoAdapter` reports real `totalRamGb`/`freeRamGb` the same way every other platform's
adapter does. See [manifest-format.md](./manifest-format.md)'s "Desktop vs. mobile" section for a
worked example manifest entry, and remember `LocalAiConfig.maxModelParamsB` (default `4`) needs raising
if you want larger desktop-class entries to survive manifest validation at all.

## Lifecycle

`ElectronAppLifecycleAdapter` splits two concerns mobile's single `AppLifecyclePort` shape didn't need
to (`docs/adr/0010-electron-app-lifecycle.md`):

- `onStateChange()` — wired to window focus/blur, debounced so moving focus between two of your own
  windows doesn't flicker. Only consulted if you opt into `LocalAiConfig.autoUnloadOnBackground`
  (default `false` on every platform, including Electron — a desktop app can keep running
  backgrounded indefinitely, unlike mobile's OS-can-kill-you-any-moment model).
- The constructor's third argument (`onBeforeQuit`) — fires **unconditionally** on `'before-quit'`,
  independent of `autoUnloadOnBackground`, since a process that's about to exit needs its runtime
  released regardless. Pass `() => client.releaseRuntime()` (best-effort — a rejection here never
  blocks quit).

See [memory-and-lifecycle.md](./memory-and-lifecycle.md) for what `releaseRuntime()` actually frees.
