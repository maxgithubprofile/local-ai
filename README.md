# local-ai

> Working name — final package name/scope, license, and npm publish status are open product
> decisions, see [`docs/decisions.md`](./docs/decisions.md) #1. Not published to npm yet.

TypeScript/Capacitor library that gives an app one local LLM, one local embedding model, resumable
downloads, a local SQLite database (chats + vector search), device/platform eligibility checks, and
managed memory lifecycle — no UI, no personas, no RAG orchestration. Full spec:
[`docs/2026-08-10-local-ai-library-tz.md`](./docs/2026-08-10-local-ai-library-tz.md).

Status: **Phases 0–7 implemented and tested**, plus most of Phase 8's post-v1 scope, a 2026-08-11
security-hardening pass, and a 2026-08-11 "Local logging & export" addition (spikes/ADRs, manifest,
support/eligibility, downloads, SQL/vectors/chats, LLM runtime + facade, session-cache/context-policy/
message send, lifecycle, docs/JSDoc/TypeDoc, full-text search, export/backup, `updateMessage`/
`deleteMessages`, manifest-URL/storage/checksum hardening, a persisted local log store) — see
[`ROADMAP.md`](./ROADMAP.md) for what's done vs. still open (message branching, Phase 8's one declined
item, is the only scoped-and-skipped post-v1 item), and each phase's status note for what is and isn't
verified from a device-less dev environment (a handful of Capacitor-only adapters are implemented
against each native plugin's real, confirmed API but can't be executed without a physical Android/iOS
device or emulator — flagged explicitly where that applies).

> ⚠️ **"Phases 0–8 done" means the design and Node-side logic are done — not that this has run on a
> phone.** The library's entire reason to exist (native LLM inference, real device downloads, real
> device sensors) lives in `src/adapters/capacitor/**`, and every ADR covering that layer
> (`docs/adr/0002`, `0003`, `0004`, `0006`) is still `proposed`, not `accepted`: APIs confirmed from
> plugin source, runtime behavior on a real device unverified (no device/emulator was available while
> building this). See "[What's verified vs. not, honestly](#whats-verified-vs-not-honestly)" below
> before depending on this for a release.

## Quickstart

```bash
pnpm install
pnpm test        # lint + typecheck + unit + integration, no device required
pnpm run test:contract
pnpm build
```

### In a Capacitor app

```ts
import { LocalAiClient } from 'local-ai';
import {
  CapacitorPlatformSupportAdapter,
  CapgoDeviceInfoAdapter,
  CapgoDownloaderAdapter,
  CapacitorFsAdapter,
  CapacitorSqliteAdapter,
  LlamaCppCapacitorAdapter,
  CapacitorAppLifecycleAdapter,
  WebCryptoHashAdapter,
  SystemClockAdapter,
} from 'local-ai/adapters/capacitor';

// core/** never imports a concrete adapter itself (hexagonal boundary) — the
// consumer assembles the full port set once, here, and hands it to create().
const ports = {
  platformSupport: new CapacitorPlatformSupportAdapter(),
  deviceInfo: new CapgoDeviceInfoAdapter(),
  downloadTransport: new CapgoDownloaderAdapter(),
  fileSystem: new CapacitorFsAdapter(),
  sqlite: new CapacitorSqliteAdapter(),
  llmRuntime: new LlamaCppCapacitorAdapter(),
  appLifecycle: new CapacitorAppLifecycleAdapter(),
  hash: new WebCryptoHashAdapter(),
  clock: new SystemClockAdapter(),
};

// Environment-only check — safe before create(), no manifestUrl/network needed.
const support = await LocalAiClient.checkSupport({ platformSupport: ports.platformSupport });
if (!support.capabilities.inference) {
  // e.g. running on web, or the native LlamaCpp plugin isn't registered in this build.
  console.warn('local-ai inference unavailable:', support.reasons);
}

const client = await LocalAiClient.create({
  manifestUrl: 'https://example.com/local-ai-manifest.json',
  eligibilityPolicy: { no: 'block', tight: 'warn' }, // defaults shown explicitly
});

await client.refreshManifest();           // fetch + validate the manifest, cache it
await client.ensureReady({                // eligibility gate -> download+verify -> load model + embedding
  onProgress: (p) => console.log(`${p.kind} ${p.percent}%`),
});

const chat = await client.createChat({ title: 'First chat' });
const stream = client.sendMessage(chat.id, 'Hello!');
for await (const token of stream) process.stdout.write(token.token);
const assistantMessage = await stream.result; // status: 'complete' | 'cancelled' | 'error'
```

### In Node (tests, scripts, no device)

Swap the import for `local-ai/adapters/node-testing` and construct the equivalent fakes/real Node
adapters (`NodeFsAdapter`, `NodeSqliteAdapter`, `NodeRangeDownloadAdapter`, `NodeLlamaCppAdapter` for
real GGUF inference via `node-llama-cpp`, or `FakeLlmRuntimeAdapter`/`FakePlatformSupportAdapter`/
`FakeDeviceInfoAdapter`/`FakeAppLifecycleAdapter` for fully offline, deterministic tests). See
`test/integration/client/local-ai-client.test.ts` for a complete worked example assembling a full
`LocalAiPorts` set this way, including a local mock HTTP server standing in for the manifest/artifact
hosts.

## Where things live

| Path | What |
|---|---|
| [`docs/2026-08-10-local-ai-library-tz.md`](./docs/2026-08-10-local-ai-library-tz.md) | Source-of-truth spec. Never contradict it silently — see `CLAUDE.md`. |
| [`ROADMAP.md`](./ROADMAP.md) | TZ §15 phases broken into agent-sized, checkable tasks, each with a status note. |
| [`docs/decisions.md`](./docs/decisions.md) | Ledger of TZ §16 open questions and their resolutions, plus implementation/tooling notes. |
| [`docs/pre-release-checklist.md`](./docs/pre-release-checklist.md) | Same open questions, re-sorted by who needs to act: product owner vs. device access vs. an agent can just do it. |
| [`docs/adr/`](./docs/adr/) | Architecture Decision Records, one per Phase 0 spike / major choice. |
| [`docs/guides/`](./docs/guides/) | Task-oriented guides (first run, eligibility, multi-chat, Mode B, lifecycle, manifest format, testing, logging & export). |
| [`CLAUDE.md`](./CLAUDE.md) | Project rules for agentic development in this repo. |
| [`src/core/`](./src/core/) | Platform-free business logic + the 9 ports (TZ §3). |
| [`src/adapters/capacitor/`](./src/adapters/capacitor/) | Production adapters over real Capacitor/Capgo plugins. |
| [`src/adapters/node-testing/`](./src/adapters/node-testing/) | Node adapters (real and fake) used in tests and as a dev-time runtime. |
| [`src/adapters/shared/`](./src/adapters/shared/) | `WebCryptoHashAdapter`/`SystemClockAdapter` — genuinely platform-generic (no `node:*` or Capacitor dependency), re-exported from *both* `adapters/capacitor` and `adapters/node-testing` so either subpath alone gives you a complete `LocalAiPorts` set. |
| [`examples/minimal-capacitor-app/`](./examples/minimal-capacitor-app/) | Worked example app (multi-chat, Mode B, eligibility screen). |

(`AsyncTokenQueue`, the callback→`AsyncIterable` bridge used by both LLM runtime adapters, lives under
`src/core/utils/` instead — `LocalAiClient.sendMessage()` needed to reuse it too, and `core/**` cannot
import from `adapters/**` even the shared ones, hexagonal boundary.)

## Logging

```ts
const client = await LocalAiClient.create({
  manifestUrl,
  ports,
  logger: { debug: console.debug, info: console.info, warn: console.warn, error: console.error }, // TZ §14, no-op by default
  logging: { enabled: true }, // opt-in persisted store — off by default; see docs/decisions.md
});

const recent = await client.exportLogs({ limit: 100 });
await client.clearLogs();
```

`logger` is a pluggable, no-op-by-default callback (TZ §14); `logging` is a separate, opt-in local
SQLite-backed store a host app can read back later (e.g. an "export logs" button) — the two are
independent. See [`docs/guides/logging-and-export.md`](./docs/guides/logging-and-export.md).

## Platform support

**Android/iOS** — inference (`LlamaCpp` native plugin) requires a native build, via
`local-ai/adapters/capacitor` (TZ §6.1).

**Electron (Windows/macOS/Linux)** — first-class, non-degraded support as of 2026-08-29
(`docs/decisions.md` #4), not the earlier "unavailable by design" framing. Import
`local-ai/adapters/electron` from your **main process only** (no native/filesystem access from the
renderer without your own IPC bridge, same split as Capacitor's WebView). Inference goes through
`llama-cpp-pro/desktop`'s compiled sidecar process (`LlamaCppProDesktopAdapter`), not `node-llama-cpp`
(that stays a Node-side test tool only, TZ §13.1) — see `docs/guides/electron-integration.md`. Every
port is implemented and tested for real, `LlmRuntimePort` included — confirmed end-to-end against a
real sidecar binary and a real GGUF model (`docs/adr/0011-electron-sidecar-build.md`'s "Resolution"
section: real streamed tokens, real embeddings, not mocked). Two honest, real caveats: the sidecar
binary itself must be staged/built per that ADR's recipe wherever the app actually runs (`checkSupport()`
reports `capabilities.inference: false` correctly if it isn't), and session-cache reuse doesn't speed up
a second message the way it does on mobile — the sidecar has no KV-cache persistence endpoint
(`docs/adr/0012-electron-sidecar-streaming.md`).

**Web (browser, not Electron)** — degraded, unchanged: the library doesn't fail at import, but inference
isn't available (TZ §4.1); `sql`/`download`/conversations may work depending on which plugins support
web.

Run `LocalAiClient.checkSupport()` before `create()` on any platform to decide what to show the user —
it reports availability per-capability rather than failing the whole library.

## License note: `@capgo/capacitor-downloader` is MPL-2.0

`local-ai` itself has no license decided yet (see `docs/decisions.md` #1). Independent of that, the
default download-transport adapter (`CapgoDownloaderAdapter`, `src/adapters/capacitor/`) depends on
`@capgo/capacitor-downloader`, which is MPL-2.0 — a **weak, file-level copyleft**: it requires source
disclosure only for modifications to *that dependency's own files*, not for your app or for `local-ai`
itself, and doesn't require your app to be open-sourced just for depending on it (unlike GPL/LGPL).
Practically: don't fork/patch `@capgo/capacitor-downloader`'s own source without publishing your
changes to it; using it as an unmodified dependency in a closed-source app is the normal, permitted
case. This is not legal advice — confirm against your own project's license policy before shipping.

## What's verified vs. not, honestly

This repo was built and tested in an environment with no physical Android/iOS device or emulator.
Everything under `src/core/**` and the Node-side adapters is exercised by real, passing automated
tests (`pnpm test` / `pnpm run test:contract` — all green as of this writing; see CI for the current
exact count rather than a number here, which would just drift out of date every phase like the last
one did — unit + integration + contract, including real GGUF inference via `node-llama-cpp` against a
tiny fixture model, not mocks). The
Capacitor production adapters (`src/adapters/capacitor/**`) are implemented against each plugin's real,
installed `.d.ts`/native source — not README guesses — but their actual on-device behavior is
unverified. `docs/adr/` documents exactly which spikes are `accepted` (desk-verifiable, e.g. plugin
registration names) vs. `proposed` (real API confirmed, but runtime behavior needs a device — e.g.
`sqlite-vec` loadExtension on iOS, download resume across a process kill). Re-run those against real
hardware before a v1 release.
