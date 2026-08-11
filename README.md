# local-ai

> Working name — final package name/scope, license, and npm publish status are open product
> decisions, see [`docs/decisions.md`](./docs/decisions.md) #1. Not published to npm yet.

TypeScript/Capacitor library that gives an app one local LLM, one local embedding model, resumable
downloads, a local SQLite database (chats + vector search), device/platform eligibility checks, and
managed memory lifecycle — no UI, no personas, no RAG orchestration. Full spec:
[`docs/2026-08-10-local-ai-library-tz.md`](./docs/2026-08-10-local-ai-library-tz.md).

Status: **Phases 0–6 implemented and tested** (spikes/ADRs, manifest, support/eligibility, downloads,
SQL/vectors/chats, LLM runtime + facade, session-cache/context-policy/message send, lifecycle) — see
[`ROADMAP.md`](./ROADMAP.md) for what's done vs. still open, and each phase's status note for what is
and isn't verified from a device-less dev environment (a handful of Capacitor-only adapters are
implemented against each native plugin's real, confirmed API but can't be executed without a physical
Android/iOS device or emulator — flagged explicitly where that applies).

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
| [`docs/adr/`](./docs/adr/) | Architecture Decision Records, one per Phase 0 spike / major choice. |
| [`docs/guides/`](./docs/guides/) | Task-oriented guides (first run, eligibility, multi-chat, Mode B, lifecycle, manifest format, testing). |
| [`CLAUDE.md`](./CLAUDE.md) | Project rules for agentic development in this repo. |
| [`src/core/`](./src/core/) | Platform-free business logic + the 9 ports (TZ §3). |
| [`src/adapters/capacitor/`](./src/adapters/capacitor/) | Production adapters over real Capacitor/Capgo plugins. |
| [`src/adapters/node-testing/`](./src/adapters/node-testing/) | Node adapters (real and fake) used in tests and as a dev-time runtime. |
| [`src/adapters/shared/`](./src/adapters/shared/) | `WebCryptoHashAdapter`/`SystemClockAdapter` — genuinely platform-generic (no `node:*` or Capacitor dependency), re-exported from *both* `adapters/capacitor` and `adapters/node-testing` so either subpath alone gives you a complete `LocalAiPorts` set. |
| [`examples/minimal-capacitor-app/`](./examples/minimal-capacitor-app/) | Worked example app (multi-chat, Mode B, eligibility screen). |

(`AsyncTokenQueue`, the callback→`AsyncIterable` bridge used by both LLM runtime adapters, lives under
`src/core/utils/` instead — `LocalAiClient.sendMessage()` needed to reuse it too, and `core/**` cannot
import from `adapters/**` even the shared ones, hexagonal boundary.)

## Platform support

Inference (`LlamaCpp` native plugin) requires a native Android/iOS build — unavailable on web/Electron
by design (TZ §2, §6.1); `checkSupport()` reports this per-capability rather than failing the whole
library, since `sql`/`download` can still work on web depending on which plugins are present. Run
`LocalAiClient.checkSupport()` before `create()` to decide what to show the user.

## What's verified vs. not, honestly

This repo was built and tested in an environment with no physical Android/iOS device or emulator.
Everything under `src/core/**` and the Node-side adapters is exercised by real, passing automated
tests (`pnpm test` / `pnpm run test:contract` — 160+ tests as of Phase 6, unit + integration + contract,
including real GGUF inference via `node-llama-cpp` against a tiny fixture model, not mocks). The
Capacitor production adapters (`src/adapters/capacitor/**`) are implemented against each plugin's real,
installed `.d.ts`/native source — not README guesses — but their actual on-device behavior is
unverified. `docs/adr/` documents exactly which spikes are `accepted` (desk-verifiable, e.g. plugin
registration names) vs. `proposed` (real API confirmed, but runtime behavior needs a device — e.g.
`sqlite-vec` loadExtension on iOS, download resume across a process kill). Re-run those against real
hardware before a v1 release.
