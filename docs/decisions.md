# Open questions ledger

Tracks resolutions to the open product/technical questions the TZ (`docs/2026-08-10-local-ai-library-tz.md`
§16) deliberately left to the product owner. **Check this before starting work that depends on one of
these** — an "Open" row means the corresponding assumption in the code/roadmap is a placeholder, not
a decision.

| # | TZ §16 question | Status | Resolution | Date | ADR |
|---|---|---|---|---|---|
| 1 | npm package name/scope + library license (interacts with MPL-2.0 downloader dep) | Open | Bootstrap placeholder: `package.json` name `local-ai`, `license: "UNLICENSED"`, `private: true` | — | — |
| 2 | Concrete default model + embedding (HF repo, commit SHA, embedding URL, `compatibleModelIds`, calibrated `minRamGb`/`recommendedRamGb`) | Open | — | — | — |
| 3 | Embedding file hosting (own CDN/server) + `@capgo/capacitor-downloader` header compatibility | Open | — | — | — |
| 4 | Whether to actively support degraded Web/Electron at all | Open | — | — | — |
| 5 | Whether `VectorStore`/`sqlite-vec` is mandatory for v1 | Open | — | — | — |
| 6 | Chat/message count or size limits | Open | — | — | — |
| 7 | Message branching (regenerate/edit-and-resubmit) in v1 | Open | — | — | — |
| 7a | Syncing edits/deletes of individual messages from the host app's own DB (Mode B) | Open | — | — | — |
| 8 | Multi-slot session-cache vs. single-slot for v1 | Open | Bootstrap follows TZ's stated v1 default: single-slot (§9.3) | — | — |
| 9 | Retention policy for `previousModels[]`/`previousEmbeddings[]` | Open | — | — | — |
| 10 | Local DB encryption (SQLCipher) | Open | — | — | — |
| 11 | Monorepo vs. single package | Open | Bootstrap follows TZ's §3.1 recommendation: single package, subpath exports | — | — |
| 12 | Device-e2e CI infrastructure (macOS runners/Android emulators) vs. fully manual | Open | — | — | — |
| 13 | Confirm `@capgo/capacitor-downloader` choice (esp. process-kill survival) | Open | Phase 0 spike ran (desk research: real API confirmed) but process-kill survival needs a physical device — `DownloadEngine` designed to always re-verify rather than trust resume blindly, so this stays functionally unblocking | 2026-08-10 | [0003](adr/0003-capgo-capacitor-downloader.md) |
| 14 | Default `eligibilityPolicy` (`block` vs `warn` for `'no'`) | Open | Bootstrap follows TZ's stated default: `no → block`, `tight/unknown → warn` (§6.4) — flagged there as a product decision, not final | — | — |
| 15 | How strictly to trust iOS thermal/low-power signals in eligibility | Open | Phase 0 spike (0004) confirmed the plugin passes `thermalState`/`lowPowerMode` through unmodified from iOS's own public APIs (no CPU/GPU temperature available on iOS, by OS design) — how much to *weight* that signal in the eligibility verdict is still a product calibration question, unchanged by this spike | 2026-08-10 | [0004](adr/0004-capgo-device-info.md) |
| 16 | Ship `ConversationSyncApi` (Mode B) in the first release at all | Open | Implemented regardless (Phase 5, `upsertChat`/`appendMessages`, idempotent by `(chatId, id)`) per `ROADMAP.md`'s framing — the *implementation* task and the *release* decision are kept separate; this row stays open as the release question | 2026-08-10 | — |
| 17 | Default `contextStrategy` (`'truncate-oldest'` vs `'fail'`) | Open | Bootstrap follows TZ's stated default: `'truncate-oldest'` (§9.7) — flagged there as a product decision, not final | — | — |
| 18 | Whether `'cancelled'`/`'error'` messages show in UI by default | Open | N/A to the library (consumer-app UI decision) — documented as an integration-guide example only | — | — |
| 19 | Is `LlmRuntimePort.countTokens()` mandatory, or is a heuristic acceptable pre-Phase-4 | Resolved | Both real runtime adapters (`NodeLlamaCppAdapter`, `LlamaCppCapacitorAdapter`) implement `countTokens()` for real via the underlying plugin's own tokenizer (`model.tokenize()`/`context.tokenize()`) — no heuristic needed once a model is loaded. A chars/4-style heuristic remains only as Phase 5's context-policy fallback for the brief window before any model is loaded (TZ §9.7) | 2026-08-10 | [0001](adr/0001-llama-cpp-capacitor-api.md) |

## How to resolve a row

1. Get the decision (from the user, or a Phase 0 spike via the `spike` skill).
2. Update `Status` → `Resolved`, fill `Resolution`/`Date`, link an ADR under `docs/adr/` if the
   resolution came from a spike or has non-trivial consequences.
3. If code already encodes the old placeholder assumption, update it in the same change — don't
   leave the ledger and the code disagreeing.

## Implementation/tooling notes (not TZ §16 questions)

Engineering decisions discovered while building, not product questions — logged here for the same
reason (so the next agent doesn't re-derive them) but outside the numbered §16 ledger above.

### Node-testing SQLite backend: `node:sqlite` instead of `better-sqlite3`

**Date:** 2026-08-10. TZ §13.1/§4.2 and the bootstrap's file naming
(`src/adapters/node-testing/better-sqlite.adapter.ts`) assumed `better-sqlite3` as the Node-side
`SqlitePort` implementation. During Phase 0/1 work, `better-sqlite3@13.0.3`'s prebuilt native binary
was found to crash (segfault) unconditionally on this dev machine — reproduced with a bare `new
Database(':memory:')`, with a freshly-downloaded tarball bypassing the pnpm store entirely, from both
the sandboxed tool shell and a native PowerShell process. Node's built-in `node:sqlite`
(`node:sqlite`'s `DatabaseSync`) was confirmed working in the same environment. Root cause not fully
diagnosed (plausibly a hypervisor/CPU-feature quirk specific to this sandboxed dev container; V8
itself reports AVX2 available, so it isn't a simple "CPU lacks AVX2" explanation) — likely
CI-environment-specific rather than a defect in `better-sqlite3` itself, but **unverifiable from
here**, and the instruction for this session was to actually run and verify tests, not assume they'd
pass elsewhere.

**Decision:** the Node-testing SQLite adapter (renamed `node-sqlite.adapter.ts`, class
`NodeSqliteAdapter`) is implemented over `node:sqlite`'s `DatabaseSync` instead of `better-sqlite3`.
Consequences accepted:
- `package.json` `engines.node` bumped from `>=18.18` to `>=22.5.0` (when `node:sqlite` stabilized
  enough for `DatabaseSync` + basic extension-loading groundwork; exact loadExtension support landed
  later — see below). This only affects contributors running this repo's own test suite; it has no
  effect on library consumers, who never touch `node:sqlite` (the production Capacitor adapter uses
  `@capacitor-community/sqlite`, unaffected).
- `better-sqlite3` and `sqlite-vec` remain installed devDependencies (used for the ADR 0002 desk
  research and kept for future re-attempts / potential CI environments where they do work), but
  `NodeSqliteAdapter` does not depend on either at runtime.
- `loadVectorExtension()` on `NodeSqliteAdapter` is a documented **no-op returning `false`** — this
  Node version's `DatabaseSync` does not yet expose `loadExtension`/`enableLoadExtension` (confirmed:
  `typeof db.loadExtension === 'undefined'` on Node 22.12.0). This does not block Phase 3: the
  sqlite-vec code path was always meant to be validated on real Android/iOS (ADR 0002), and the
  brute-force `VectorStore` fallback (task 3.6) is fully exercised over `NodeSqliteAdapter` instead.
- If a contributor's environment has working `better-sqlite3` and wants to exercise the sqlite-vec
  Node path, a second, opt-in `test/contract` parametrization can add `BetterSqliteAdapter` back
  later without removing `NodeSqliteAdapter` — not done now since it can't be verified from here.
