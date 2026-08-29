# minimal-electron-app

Worked example of `local-ai`'s API surface on Electron — TZ v6, `ROADMAP.md`'s "Electron desktop
support" Phase 4 (ELEC.4.1).

**This is illustrative source, not a scaffolded/buildable Electron project** — there's no
`electron-builder` config, no renderer UI, and `package.json`'s `local-ai: "workspace:*"` dependency
only resolves inside this monorepo-style checkout. Same treatment `minimal-capacitor-app` already gets
(see its own README for the reasoning) — the point of this folder is *correct, complete calling code*
against `local-ai`'s real, implemented Electron API, not a CI-buildable app.

## What's covered, and where

| Scenario | File |
|---|---|
| Assembling the full `LocalAiPorts` set in the main process, creating the shared client | [`src/local-ai-setup.ts`](./src/local-ai-setup.ts) |
| "Chat isn't available on this build" screen (`checkSupport()`, before `create()`) | [`src/eligibility-screen.ts`](./src/eligibility-screen.ts) |
| Wiring order at app boot | [`src/main.ts`](./src/main.ts) |
| Illustrative main↔renderer IPC bridge (`contextBridge`/`ipcMain.handle`) | [`src/ipc-bridge-sample.ts`](./src/ipc-bridge-sample.ts) |

## What's real, including chat completion

Every port in `local-ai-setup.ts`, `llmRuntime` included, is `local-ai`'s real, implemented Electron
API — `LlamaCppProDesktopAdapter` was confirmed working end-to-end in this repo's own dev environment
against a real sidecar binary and a real GGUF model (`docs/adr/0011-electron-sidecar-build.md`'s
"Resolution" section: real streamed tokens, real embeddings). `main.ts` calls `sendMessage()` for real,
not a stub. Two honest caveats, not glossed over:

1. **The sidecar binary itself must actually be staged** wherever this app runs —
   `LlamaCppProDesktopAdapter` talks to `llama-cpp-pro/desktop`'s sidecar process, which needs a real
   compiled binary under `extraResources/sidecar/` (or built locally per ADR 0011's recipe). If it's
   missing, `checkSupport().capabilities.inference` correctly reports `false` (a real
   `assertSidecarBinary()` check, not a hardcoded flag) rather than `sendMessage()` failing confusingly.
2. **No session-cache speedup.** `docs/adr/0012-electron-sidecar-streaming.md` (ledger row #26) found
   the sidecar has no KV-cache persistence endpoint — every message reprocesses the full prompt from
   scratch. TZ §9.3's "second response in the same chat is measurably faster" claim doesn't hold on
   Electron the way it does on mobile.

**2+ chats / Mode B / embedding switch / logs export** — structurally identical to
`minimal-capacitor-app`'s equivalents (same `LocalAiClient` methods, same behavior, TZ §9); not
duplicated here to avoid two copies of the same demonstration code drifting apart. See that example's
`src/chats.ts`/`src/mode-b-chat.ts`/`src/embedding-update.ts`/`src/logs.ts`.

See [`docs/guides/electron-integration.md`](../../docs/guides/electron-integration.md) for the full
explanation this example is deliberately terse about.
