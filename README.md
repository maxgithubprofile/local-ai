# local-ai

> Working name — final package name/scope is an open product decision, see
> [`docs/decisions.md`](./docs/decisions.md) §16.1. Not published yet.

TypeScript/Capacitor library that gives an app one local LLM, one local embedding model, resumable
downloads, a local SQLite database (chats + vector search), device/platform eligibility checks, and
managed memory lifecycle — no UI, no personas, no RAG orchestration. Full spec:
[`docs/2026-08-10-local-ai-library-tz.md`](./docs/2026-08-10-local-ai-library-tz.md).

Status: **infrastructure bootstrap** — hexagonal skeleton, types transcribed from the TZ, tooling and CI
gates are in place; service/adapter logic is stubbed pending [`ROADMAP.md`](./ROADMAP.md) Phase 0+.

## Quickstart (WIP — filled in during Phase 7, TZ §12)

```bash
pnpm install
pnpm test        # lint + typecheck + unit + integration, no device required
pnpm build
```

```ts
// Not implemented yet — public shape per TZ §10, tracked in ROADMAP.md Phase 1-6.
import { LocalAiClient } from 'local-ai';

const support = await LocalAiClient.checkSupport();
const client = await LocalAiClient.create({ manifestUrl: 'https://…' });
await client.ensureReady();
const chat = await client.createChat();
```

## Where things live

| Path | What |
|---|---|
| [`docs/2026-08-10-local-ai-library-tz.md`](./docs/2026-08-10-local-ai-library-tz.md) | Source-of-truth spec. Never contradict it silently — see `CLAUDE.md`. |
| [`ROADMAP.md`](./ROADMAP.md) | TZ §15 phases broken into agent-sized, checkable tasks. |
| [`docs/decisions.md`](./docs/decisions.md) | Ledger of TZ §16 open questions and their resolutions. |
| [`docs/adr/`](./docs/adr/) | Architecture Decision Records, one per Phase 0 spike / major choice. |
| [`CLAUDE.md`](./CLAUDE.md) | Project rules for agentic development in this repo. |
| [`src/core/`](./src/core/) | Platform-free business logic + ports (TZ §3). |
| [`src/adapters/capacitor/`](./src/adapters/capacitor/) | Production adapters (Capacitor plugins). |
| [`src/adapters/node-testing/`](./src/adapters/node-testing/) | Node adapters used in tests and as a dev-time runtime. |

## Platform support

Web/Electron: degraded mode only, inference unavailable (TZ §2, §6.1). Not evaluated until Phase 4.
