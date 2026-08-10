# Roadmap

`docs/2026-08-10-local-ai-library-tz.md` §15 defines 8 phases at a design-review level. This file
breaks each into tasks sized for one agent session (a few files, one testable outcome each), in
dependency order, so picking up work here doesn't require re-reading the whole TZ every time.

**How to use this file:** pick the first unchecked task whose dependencies are checked. Read the TZ
section(s) it cites. If it's blocked by an open question, resolve it (`docs/decisions.md`) or ask
before guessing. When done, run the `phase-gate` skill before ticking the box.

## Open Questions Ledger

Several tasks below are flagged **⚠ blocked by §16.N** — see [`docs/decisions.md`](docs/decisions.md)
for the full list and current status. A flagged task can usually still get an unblocking placeholder
(the bootstrap already added a few, e.g. `license: "UNLICENSED"`) but should not ship a real release
depending on that placeholder without the question actually being resolved.

---

## Phase 0 — Spikes (TZ §15 row 0, §17 risk table)

Each row below is run via the `spike` skill and produces an ADR under `docs/adr/`. None of Phase 1-6
work that depends on a spike's outcome should start until that spike's ADR exists (`accepted`, not
just `proposed`).

- [ ] **0.1 `llama-cpp-capacitor` API spike** — confirm real method signatures for `initLlama`,
  `completion` (stream), `embedding`, `release`/`releaseAllLlama`, `stopCompletion`,
  `saveSession`/`loadSession`, `loadLlamaModelInfo` against the installed package version, not the
  README (TZ §4.1). Blocks: Phase 4.
- [ ] **0.2 `sqlite-vec` via `loadExtension()` spike** — Android and iOS, TZ §4.2/§8.3. Determines
  whether Phase 3's `VectorStore` primary path is viable or the brute-force fallback ships first.
  Blocks: Phase 3.
- [ ] **0.3 `@capgo/capacitor-downloader` spike** — resume after app backgrounding *and* after
  process kill, `wifi-only` option, exact `destination` path format (TZ §4.4, §7.2). ⚠ resolves
  §16.13. Blocks: Phase 2.
- [ ] **0.4 `@capgo/capacitor-device-info` spike** — real `getSnapshot()` fields, RAM/thermal
  accuracy on one real Android + one real iOS device (TZ §4.5, §6.2). Blocks: Phase 4 (eligibility
  wiring), informs §16.15.
- [ ] **0.5 `Capacitor.isPluginAvailable()` plugin-name constants** — collect the exact registration
  string for every native plugin in use (TZ §6.1). Blocks: `SupportChecker` implementation (Phase 1).
- [ ] **0.6 Streaming SHA-256 timing spike** — measure hashing a ~2.5GB file on a mid-range Android
  device (TZ §7.4, §17). Informs whether background hashing UX (progress) is required in Phase 2.

**Phase 0 exit criterion:** an ADR per row above, `accepted` or explicitly `rejected` with a
documented fallback (e.g. 0.2 rejected → brute-force fallback adopted as primary for v1).

---

## Phase 1 — Core skeleton (TZ §15 row 1)

Bootstrap already delivered: package scaffold, all 9 ports, manifest/support/download/conversation
types, error hierarchy, event map, `LocalAiClient` method-signature shell, SQL migration `001_init.sql`,
and a fully-implemented + unit-tested `evaluateEligibility()`. Remaining:

- [ ] **1.1 `ManifestService`** (`src/core/manifest/manifest.service.ts`) — fetch with
  `If-None-Match`, schema validation (TZ §5.2's full rule list), ETag cache in `kv_store`, emits
  `manifest:invalid` on failure instead of throwing past `LocalAiClient`. Depends on: `SqlitePort`
  usable (can use `BetterSqliteAdapter` stub target, or a minimal in-memory fake first).
- [ ] **1.2 `diffManifest()`** (`src/core/manifest/manifest.diff.ts`) — implement the body per TZ
  §5.4's flow; unit-test both `modelChanged`/`embeddingChanged` independently.
- [ ] **1.3 `SupportChecker`** (`src/core/support/support-checker.ts`) — implement per TZ §6.1's
  degradation rule table. ⚠ blocked by 0.5 for the real plugin-name constants (use a placeholder
  constants file otherwise, clearly marked TODO).
- [ ] **1.4 `EligibilityService` class** (`src/core/support/eligibility-service.ts`) — wraps
  `evaluateEligibility()` (already implemented) with a live `DeviceInfoPort` snapshot + `kv_store`
  persisted `LocalRuntimeVerdict`s (TZ §6.3), plus `resetLocalVerdicts()`.
- [ ] **1.5 `FakePlatformSupportAdapter` + `FakeDeviceInfoAdapter` + `FakeClockAdapter`** — real
  implementations (constructor-injectable fixtures) backing 1.3/1.4's tests.
- [ ] **1.6 CI workflow** — GitHub Actions (or equivalent) running `pnpm test` (lint+typecheck+unit+
  integration) on every PR, per TZ §13.5. `test:device-e2e` not included.

**Phase 1 exit criterion (TZ §15):** `npm test` green on manifest, support, and eligibility logic.

---

## Phase 2 — Download engine (TZ §15 row 2)

Depends on: 0.3 (transport choice), 0.6 (hashing perf expectations).

- [ ] **2.1 `WebCryptoHashAdapter`** (`src/adapters/node-testing/web-crypto-hash.adapter.ts`) —
  implement `sha256`/`createSha256` over `node:crypto`'s webcrypto; confirm it also works unmodified
  as the production adapter (TZ §7.4) or split it if not.
  - [ ] **2.1a `checksum.ts`** — implement `verifyChecksum()` using `HashPort` + `FileSystemPort.readChunks`.
- [ ] **2.2 `NodeRangeDownloadAdapter`** — real `Range:`-request implementation for the mock-HTTP
  test harness described in TZ §7.3.
- [ ] **2.3 Mock HTTP test server** (`test/integration/download/`) that can drop connections,
  change `ETag`, or omit `Accept-Ranges` on demand.
- [ ] **2.4 `DownloadEngine`** (`src/core/download/download-engine.ts`) — orchestration per TZ §7's
  pseudocode: state load-or-create, short-circuit already-verified, retry w/ backoff, checksum on
  completion.
- [ ] **2.5 `download_state` persistence** wired through `SqlitePort` (needs 3.x's `Database`
  migration runner, or a minimal standalone runner pulled forward — decide when starting this task).
- [ ] **2.6 `CapgoDownloaderAdapter`** — real implementation per the 0.3 ADR's confirmed API.

**Phase 2 exit criterion (TZ §15):** contract test "resume after 50% cutoff → sha256 valid" green
(`test/contract/download-transport.contract.ts`, parametrized over `NodeRangeDownloadAdapter` and,
if a device is available, `CapgoDownloaderAdapter`).

---

## Phase 3 — SQL: system + chats + vectors, MVP `ConversationApi` (TZ §15 row 3)

Depends on: 0.2 (`sqlite-vec` viability).

- [ ] **3.1 `Database` migration runner** (`src/core/db/database.ts`) — applies numbered files under
  `src/core/db/migrations/` in transactions, tracks `_local_ai_migrations`.
- [ ] **3.2 `BetterSqliteAdapter`** — real implementation incl. `loadVectorExtension()` attempting
  `sqlite-vec`.
- [ ] **3.3 `CapacitorSqliteAdapter`** — real implementation, `loadVectorExtension()` per the 0.2 ADR.
- [ ] **3.4 `ConversationStore` MVP** (`src/core/conversations/conversation-store.ts`) —
  `createChat`/`listChats`/`getChat`/`renameChat`/`deleteChat` (cascade)/`getMessages` per TZ §9.1-9.2
  Mode A only; `ConversationSyncApi` methods deferred to Phase 5 per TZ §15.
- [ ] **3.5 `VectorStore` — sqlite-vec path** (`src/core/db/vector-store.ts` gets its first real
  implementing class) — if 0.2 was accepted.
- [ ] **3.6 `VectorStore` — brute-force fallback** — cosine similarity in TS over a `BLOB` column;
  emits `vector-store:fallback-active`. Ships regardless of 0.2's outcome (documented fallback, TZ
  §8.3), not only if sqlite-vec fails.
- [ ] **3.7 `VectorSpaceMismatchError` guard** — both implementations check `vector_space` on every
  `upsert`/`search`; `reindex()` is the only way to switch spaces (TZ §8.2).
- [ ] **3.8 Contract tests** (`test/contract/vector-store.contract.ts`,
  `test/contract/conversation-store.contract.ts`) — CRUD, cascade delete, the mismatch-guard scenario,
  parametrized over both `VectorStore` implementations.

**Phase 3 exit criterion (TZ §15):** chat CRUD + cascade delete tests green; `VectorStore.search()`
green on both paths + the guard test on space mismatch.

---

## Phase 4 — Runtime + facade + eligibility gate + chat template (TZ §15 row 4)

Depends on: 0.1 (`llama-cpp-capacitor` API), 0.4 (device-info), 1.3/1.4 (support/eligibility).

- [ ] **4.1 `LlmRuntimePort.countTokens()` decision** — resolve §16.19 (real tokenizer call vs.
  chars/4 heuristic pre-Phase-4) before wiring the context policy that depends on it.
- [ ] **4.2 `NodeLlamaCppAdapter`** — real implementation via `node-llama-cpp`, small (0.1-0.5B)
  fixture GGUFs under `test/fixtures/` (TZ §13.4).
- [ ] **4.3 `LlamaCppCapacitorAdapter`** — real implementation per the 0.1 ADR.
- [ ] **4.4 Chat-template preset registry** — pure function mapping `ModelArtifact.chatTemplate`
  (`qwen`/`llama3`/`gemma`/`mistral`/`raw`) to a formatted prompt, for the fallback path (TZ §4.1
  mechanism 2). Unit test per preset against a captured reference formatting.
- [ ] **4.5 `RuntimeFacade`** (`src/core/runtime/runtime-facade.ts`) — resolves mechanism 1 vs. 2,
  enforces `RuntimeBusyError` (single concurrent generation, TZ §9.4).
- [ ] **4.6 Wire `checkSupport`/`checkDeviceEligibility`/`ensureModelReady`/`ensureEmbeddingReady`/
  `complete`/`embed`** on `LocalAiClient` for real, replacing their stub bodies.

**Phase 4 exit criterion (TZ §15):** facade logic green in Node incl. per-preset chat-template unit
tests; manual smoke test on a low-end and high-end emulator confirms reasonable eligibility verdicts.

---

## Phase 5 — Session-cache + multi-chat + context policy + `ConversationSyncApi` (TZ §15 row 5)

- [ ] **5.1 `SessionCache`** (`src/core/conversations/session-cache.ts`) — single hot-slot per TZ
  §9.3; rebuild-from-SQL fallback on missing/corrupt/incompatible session file.
- [ ] **5.2 `sendMessage()`** on `LocalAiClient` (MVP `ConversationApi`) — user message saved before
  generation starts (TZ §9.8), `RuntimeBusyError` on concurrent chat generation.
- [ ] **5.3 Context window policy** — `contextStrategy`/`maxContextTokens` per TZ §9.7's algorithm
  (`fail` / `truncate-oldest` / `truncate-to-fit`); pure function, unit-testable without a model.
  ⚠ default value blocked by §16.17 — bootstrap/TZ default is `'truncate-oldest'`.
- [ ] **5.4 Cancel/error status semantics** — `status: 'complete'|'cancelled'|'error'` per TZ §9.8's
  table; fake `LlmRuntimePort` emulating an `AbortSignal` mid-stream and a thrown runtime error.
- [ ] **5.5 Model/embedding switch flows** — `switchModel()`/`switchEmbedding()` implementing TZ
  §5.5/§5.6's safe ordering exactly, incl. session-cache invalidation on model switch and
  `vector-store:embedding-changed` on embedding switch.
- [ ] **5.6 `ConversationSyncApi`** (`upsertChat`/`appendMessages`, Mode B, TZ §9.6) — idempotent
  upsert/append semantics, dedup by `(chatId, id)`. ⚠ whether this ships in v1 at all is §16.16 —
  implement regardless (it's cheap once 3.4 exists) but treat the *release* decision as separate from
  the *implementation* task.

**Phase 5 exit criterion (TZ §15):** switching chats doesn't lose history; a long conversation
truncates per policy without crashing; cancellation preserves a partial `'cancelled'` response;
second response in the same chat is measurably faster (session reuse).

---

## Phase 6 — Lifecycle + orphan cleanup (TZ §15 row 6)

- [ ] **6.1 `LifecycleManager.releaseRuntime()`** — implements the exact TZ §11.1 boundary (releases
  contexts + in-memory caches; never touches files/chats/`download_state`); idempotent.
- [ ] **6.2 `unloadAll()` alias** already wired in the `LocalAiClient` stub — just confirm it still
  delegates once `releaseRuntime()` is real.
- [ ] **6.3 `autoUnloadOnBackground`** — `CapacitorAppLifecycleAdapter` real implementation +
  `LifecycleManager` wiring per TZ §11.2 (no eager reload on refocus).
- [ ] **6.4 Independent orphan cleanup** for model vs. embedding files after a switch (TZ §5.5/§5.6
  step 6).

**Phase 6 exit criterion (TZ §15):** idempotency test green; manual on-device pass confirms memory is
actually released (accounting for TZ §11.3's OS page-cache caveat).

---

## Phase 7 — Documentation and hardening (TZ §15 row 7)

- [ ] **7.1 README quickstart** — replace the WIP placeholder in the root `README.md` with a real,
  runnable example against the now-implemented API.
- [ ] **7.2 100% JSDoc gate** — audit every exported symbol; `eslint-plugin-jsdoc` should already be
  failing CI on gaps, this task is closing the last of them.
- [ ] **7.3 TypeDoc site** — `pnpm docs` wired into CI as an artifact/publish step.
- [ ] **7.4 Guides** (`docs/guides/`) — one file per topic listed in TZ §12: first run,
  support/eligibility checks, multiple chats, Mode B integration, independent model/embedding
  updates, memory/lifecycle, testing consumer apps, manifest format.
- [ ] **7.5 ADR archive completeness** — confirm every TZ §12-listed ADR topic has a corresponding
  file under `docs/adr/` (native plugin choice, SQLite plugin, sqlite-vec/iOS, downloader,
  device-info + threshold calibration).
- [ ] **7.6 Example app** — flesh out `examples/minimal-capacitor-app/`: 2+ chats, one in Mode B,
  independent embedding update, "device not supported/not eligible" screen.

**Phase 7 exit criterion (TZ §15):** example app builds and passes a manual happy-path run.

---

## Phase 8 — Post-v1 (TZ §15 row 8, explicitly out of scope until requested)

Message branching (`parentMessageId`), multi-slot LRU session-cache, full-text search across chats
(FTS5), export/backup, `updateMessage`/`deleteMessages`. Do not start any of these without an
explicit new task — they're listed here only so they aren't silently reinvented mid-Phase-1-7.
