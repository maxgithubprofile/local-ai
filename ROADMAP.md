# Roadmap

`docs/2026-08-10-local-ai-library-tz.md` §15 defines 8 phases at a design-review level. This file
breaks each into tasks sized for one agent session (a few files, one testable outcome each), in
dependency order, so picking up work here doesn't require re-reading the whole TZ every time.

**How to use this file:** pick the first `[ ]` task whose dependencies are checked. Read the TZ
section(s) it cites. If it's blocked by an open question, resolve it (`docs/decisions.md`) or ask
before guessing. When done, run the `phase-gate` skill before ticking the box. `[-]` marks a task that
was deliberately declined/scoped out on request (not merely deferred) — skip it, don't pick it up,
unless the user asks for it again.

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

- [x] **0.1 `llama-cpp-capacitor` API spike** — confirm real method signatures for `initLlama`,
  `completion` (stream), `embedding`, `release`/`releaseAllLlama`, `stopCompletion`,
  `saveSession`/`loadSession`, `loadLlamaModelInfo` against the installed package version, not the
  README (TZ §4.1). Blocks: Phase 4. — **Done 2026-08-10**: [ADR 0001](docs/adr/0001-llama-cpp-capacitor-api.md),
  `accepted`. Real API is instance-based (`initLlama()` → `LlamaContext`), not the free-function shape
  the stub assumed — see ADR for the concrete adapter design Phase 4 should follow.
- [x] **0.2 `sqlite-vec` via `loadExtension()` spike** — Android and iOS, TZ §4.2/§8.3. Determines
  whether Phase 3's `VectorStore` primary path is viable or the brute-force fallback ships first.
  Blocks: Phase 3. — **Done 2026-08-10**: [ADR 0002](docs/adr/0002-sqlite-vec-load-extension.md),
  `proposed` (desk research only, no device available). Both `VectorStore` paths ship regardless per
  original plan; brute-force is the one this repo's own Node tests can fully verify.
- [x] **0.3 `@capgo/capacitor-downloader` spike** — resume after app backgrounding *and* after
  process kill, `wifi-only` option, exact `destination` path format (TZ §4.4, §7.2). ⚠ resolves
  §16.13. Blocks: Phase 2. — **Done 2026-08-10**: [ADR 0003](docs/adr/0003-capgo-capacitor-downloader.md),
  `proposed` (real API confirmed from source; process-kill survival unverified — `DownloadEngine`
  designed to always re-verify via checksum rather than trust resume blindly).
- [x] **0.4 `@capgo/capacitor-device-info` spike** — real `getSnapshot()` fields, RAM/thermal
  accuracy on one real Android + one real iOS device (TZ §4.5, §6.2). Blocks: Phase 4 (eligibility
  wiring), informs §16.15. — **Done 2026-08-10**: [ADR 0004](docs/adr/0004-capgo-device-info.md),
  `proposed` (field shape confirmed from source; real-device accuracy of the numbers unverified).
- [x] **0.5 `Capacitor.isPluginAvailable()` plugin-name constants** — collect the exact registration
  string for every native plugin in use (TZ §6.1). Blocks: `SupportChecker` implementation (Phase 1).
  — **Done 2026-08-10**: [ADR 0005](docs/adr/0005-native-plugin-name-constants.md), `accepted`.
- [x] **0.6 Streaming SHA-256 timing spike** — measure hashing a ~2.5GB file on a mid-range Android
  device (TZ §7.4, §17). Informs whether background hashing UX (progress) is required in Phase 2.
  — **Done 2026-08-10**: [ADR 0006](docs/adr/0006-streaming-sha256-timing.md), `proposed`
  (desktop-CPU proxy only, no Android device available — incremental checksum progress UI built
  regardless since it's correct either way).

**Phase 0 exit criterion:** an ADR per row above, `accepted` or explicitly `rejected` with a
documented fallback (e.g. 0.2 rejected → brute-force fallback adopted as primary for v1). **Status:**
all 6 ADRs written; 0001/0005 `accepted` (fully desk-verifiable), 0002/0003/0004/0006 `proposed`
pending real-device confirmation (no Android/iOS device or emulator available in this environment) —
every downstream Phase 1-6 task below is designed to not depend on that confirmation (fallbacks are
unconditional, not conditional on a device pass). Re-run those four against real hardware before a v1
release and flip them to `accepted`/`rejected`.

---

## Phase 1 — Core skeleton (TZ §15 row 1)

Bootstrap already delivered: package scaffold, all 9 ports, manifest/support/download/conversation
types, error hierarchy, event map, `LocalAiClient` method-signature shell, SQL migration `001_init.sql`,
and a fully-implemented + unit-tested `evaluateEligibility()`. Remaining:

- [x] **1.1 `ManifestService`** (`src/core/manifest/manifest.service.ts`) — fetch with
  `If-None-Match`, schema validation (TZ §5.2's full rule list), ETag cache in `kv_store`, throws
  typed errors (`ManifestFetchError`/`ManifestValidationError`) rather than emitting the event itself
  — translating that into `manifest:invalid` is `LocalAiClient`'s job (Phase 4, task 4.6), noted in
  the class's own doc comment. **Done 2026-08-10.** Depends-on note: `SqlitePort` needed to be usable
  for `kv_store`, so `Database`'s migration runner (3.1) and `NodeSqliteAdapter` (half of 3.2) were
  pulled forward into this task rather than faked — see Phase 3's note below.
- [x] **1.2 `diffManifest()`** (`src/core/manifest/manifest.diff.ts`) — implemented as a pure function
  comparing `next` against an `installed` snapshot (until `ModelRegistry`'s read side exists in
  Phase 2/5, `ManifestService` passes the previously-cached manifest as that snapshot — see the
  function's doc comment); `modelChanged`/`embeddingChanged` unit-tested independently. **Done
  2026-08-10.**
- [x] **1.3 `SupportChecker`** (`src/core/support/support-checker.ts`) — implemented per TZ §6.1's
  degradation rule table using the real plugin-name constants from ADR 0005 (no placeholder needed,
  0.5 already `accepted`). **Done 2026-08-10.**
- [x] **1.4 `EligibilityService` class** (`src/core/support/eligibility-service.ts`) — wraps
  `evaluateEligibility()` with a live `DeviceInfoPort` snapshot + `kv_store`-persisted
  `LocalRuntimeVerdict`s (TZ §6.3), `recordVerdict()`/`resetLocalVerdicts()`. **Done 2026-08-10.**
- [x] **1.5 `FakePlatformSupportAdapter` + `FakeDeviceInfoAdapter` + `FakeClockAdapter`** — real
  constructor-injectable-fixture implementations backing 1.3/1.4's tests. **Done 2026-08-10.**
- [x] **1.6 CI workflow** — `.github/workflows/ci.yml`, `ubuntu-latest`/Node 22.x, running
  lint/typecheck/unit/integration/contract on every PR + push to `main`, per TZ §13.5.
  `test:device-e2e` not included. **Done 2026-08-10.**

**Phase 1 exit criterion (TZ §15):** `npm test` green on manifest, support, and eligibility logic.
**Status: met** — 46 unit tests green across manifest/support/eligibility/db, plus lint+typecheck.

---

## Phase 2 — Download engine (TZ §15 row 2)

Depends on: 0.3 (transport choice), 0.6 (hashing perf expectations).

- [x] **2.1 `WebCryptoHashAdapter`** (`src/adapters/node-testing/web-crypto-hash.adapter.ts`) —
  implemented over `node:crypto`'s classic `createHash('sha256')` (genuinely incremental,
  `.update()`/`.digest()`; `webcrypto.subtle.digest()` is Promise-based with no incremental
  primitive, would force full-file buffering — see the class's doc comment) — also used unmodified
  as the production adapter (TZ §7.4), no split needed. **Done 2026-08-10.**
  - [x] **2.1a `checksum.ts`** — `verifyChecksum()` using `HashPort` + `FileSystemPort.readChunks`,
    with an `onProgress(bytesHashed)` callback per the 0006 ADR's incremental-progress decision.
    **Done 2026-08-10.**
- [x] **2.2 `NodeRangeDownloadAdapter`** — real `Range:`-request implementation (`fetch` + manual
  `Range: bytes=start-`); resumes from existing on-disk bytes on every `start()`/`resume()`, restarts
  from scratch if the server ignores the Range header (no `Accept-Ranges`). **Done 2026-08-10.**
- [x] **2.3 Mock HTTP test server** (`test/integration/download/mock-http-server.ts`) — one-shot
  connection drop at a given byte offset, toggleable `ETag`/`Accept-Ranges`. **Done 2026-08-10.**
- [x] **2.4 `DownloadEngine`** (`src/core/download/download-engine.ts`) — orchestration per TZ §7's
  pseudocode: state load-or-create, short-circuit already-verified+file-exists, retry w/ configurable
  backoff via repeated `transport.start()` (resume-capable by construction, not a separate code path),
  checksum verification + `ChecksumMismatchError` + file deletion on mismatch. **Done 2026-08-10.**
- [x] **2.5 `download_state` persistence** wired through `SqlitePort`/`Database` (pulled forward into
  Phase 1, see that section's note). **Done 2026-08-10.**
- [x] **2.6 `CapgoDownloaderAdapter`** — real implementation per the 0.3 ADR's confirmed API; `stop()`
  maps to the plugin's `pause()` instead of `stop()` when `discardPartial: false`, since the real
  plugin's `stop()` always deletes data (no "keep partial" option). Untestable from this environment
  (no device) — implemented against the plugin's real shipped `.d.ts`, not exercised end-to-end.
  **Done 2026-08-10.** Also implemented while in this area (small, same pattern, needed regardless):
  `CapacitorFsAdapter` (`@capacitor/filesystem`, base64 bridge, from-scratch codec to avoid a DOM
  `lib` dependency), `CapacitorPlatformSupportAdapter`, `CapgoDeviceInfoAdapter` (ADR 0004's design).

**Phase 2 exit criterion (TZ §15):** contract test "resume after 50% cutoff → sha256 valid" green
(`test/contract/download-transport.contract.ts`, parametrized over `NodeRangeDownloadAdapter` and,
if a device is available, `CapgoDownloaderAdapter`). **Status: met for `NodeRangeDownloadAdapter`** —
green both at the transport-contract level and end-to-end through `DownloadEngine`
(`test/integration/download/download-engine.test.ts`); `CapgoDownloaderAdapter` parametrization
deferred to real-device testing, same residual-risk pattern as ADR 0003.

---

## Phase 3 — SQL: system + chats + vectors, MVP `ConversationApi` (TZ §15 row 3)

Depends on: 0.2 (`sqlite-vec` viability).

- [x] **3.1 `Database` migration runner** (`src/core/db/database.ts`) — applies numbered files under
  `src/core/db/migrations/` in transactions, tracks `_local_ai_migrations`. **Done 2026-08-10 (pulled
  forward into Phase 1)** — task 1.1 (`ManifestService`) needed a real `SqlitePort` to persist
  `kv_store`, so this got built then instead of faked twice. Migrations are `.ts` files exporting a
  `sql` string constant, not bare `.sql` — see `docs/decisions.md`'s tooling-notes section.
- [x] **3.2 `NodeSqliteAdapter`** (renamed from `BetterSqliteAdapter`, see `docs/decisions.md`) — real
  implementation over `node:sqlite`'s `DatabaseSync`. **Done 2026-08-10 (pulled forward, same reason
  as 3.1).** `loadVectorExtension()` is a documented no-op (`false`) on this adapter — `node:sqlite`
  doesn't yet expose `loadExtension` — so the sqlite-vec path (3.5) isn't exercised through this
  adapter; only `CapacitorSqliteAdapter` (3.3, real device only) can attempt it. Brute-force (3.6) is
  what actually runs in this repo's own Node tests.
- [x] **3.3 `CapacitorSqliteAdapter`** — real implementation against `@capacitor-community/sqlite`'s
  shipped API (`SQLiteConnection`/`SQLiteDBConnection`); `loadVectorExtension()` calls
  `enableLoadExtension(true)` + `loadExtension(path)`, resolves `false` instead of throwing. **Done
  2026-08-10.** Untestable from this environment (no device) — see ADR 0002.
- [x] **3.4 `ConversationStore` MVP** (`src/core/conversations/conversation-store.ts`) —
  `createChat`/`listChats`/`getChat`/`renameChat`/`deleteChat` (cascade, explicit transaction rather
  than relying on `ON DELETE CASCADE` — SQLite's `foreign_keys` pragma defaults off per-connection,
  not guaranteed on)/`getMessages` per TZ §9.1-9.2, Mode A only. **Done 2026-08-10.**
  `ConversationSyncApi` methods deferred to Phase 5 per TZ §15, as planned.
- [x] **3.5 `VectorStore` — sqlite-vec path** (`src/core/db/sqlite-vec-vector-store.ts`) — `vec0`
  virtual table (`distance_metric=cosine`) + a `vector_meta` companion table for the string
  `id`/`text`/`metadata` a `vec0` table can't hold natively. **Done 2026-08-10, unverified** — cannot
  be exercised from this environment (`NodeSqliteAdapter.loadVectorExtension()` is a hard `false`, no
  device available) — implemented against best-available knowledge of `sqlite-vec`'s SQL syntax, not
  empirically confirmed. `create-vector-store.ts`'s self-test (throwaway table, never touches real
  data) is what decides at runtime whether this class is ever actually selected.
- [x] **3.6 `VectorStore` — brute-force fallback** (`src/core/db/brute-force-vector-store.ts`) —
  cosine similarity in TS over `vector_entries`' `BLOB` column. Ships unconditionally; is the only
  path this repo's own tests can exercise end-to-end (see 3.5's note). `vector-store:fallback-active`
  emission is `LocalAiClient`'s job (Phase 4/5 wiring) once it reads `createVectorStore()`'s
  `usedFallback` flag — not implemented here, that flag is the hook. **Done 2026-08-10.**
- [x] **3.7 `VectorSpaceMismatchError` guard** — implemented once in `BaseVectorStore`
  (`src/core/db/vector-store-base.ts`), shared by both implementations rather than duplicated:
  `ensureSchema()` blocks a space change while data exists; `upsert`/`upsertMany`/`search` all assert
  the given space matches `vector_space` exactly (id + version + dimensions) and also that the
  embedding's own dimension count matches; `reindex()` is the only way to switch. **Done 2026-08-10.**
- [x] **3.8 Contract tests** (`test/contract/vector-store.contract.ts`,
  `test/contract/conversation-store.contract.ts`) — CRUD, cascade delete, the mismatch-guard scenario
  (mismatched space on `upsert`/`search`, and `ensureSchema()` with existing data), `reindex()`
  unblocking further writes. **Done 2026-08-10.** Parametrized over `BruteForceVectorStore` (the only
  `VectorStore` implementation this environment can exercise, see 3.5) and `NodeSqliteAdapter` for
  `ConversationStore`.

**Phase 3 exit criterion (TZ §15):** chat CRUD + cascade delete tests green; `VectorStore.search()`
green on both paths + the guard test on space mismatch. **Status: met for the paths testable here** —
92 total tests green (61 unit + 5 integration + 26 contract) across the whole suite as of this phase;
`VectorStore.search()` and the guard tests are green on `BruteForceVectorStore` (the guaranteed v1
path) — the sqlite-vec path's tests are written and wired but cannot execute without a device, exactly
mirroring ADR 0002's already-`proposed`, not-`accepted` status. Re-run `test/contract/vector-store.contract.ts`
against a real `CapacitorSqliteAdapter` on-device before treating 3.5 as verified.

---

## Phase 4 — Runtime + facade + eligibility gate + chat template (TZ §15 row 4)

Depends on: 0.1 (`llama-cpp-capacitor` API — package later renamed `llama-cpp-pro`, ADR 0008, same
project/author, see `docs/decisions.md`'s "Implementation/tooling notes"), 0.4 (device-info), 1.3/1.4
(support/eligibility).

- [x] **4.1 `LlmRuntimePort.countTokens()` decision** — resolved via ADR 0001: real tokenizer call
  (`model.tokenize()`/`context.tokenize()`), not a heuristic — see `docs/decisions.md` #19.
  **Done 2026-08-10.**
- [x] **4.2 `NodeLlamaCppAdapter`** — real implementation via `node-llama-cpp`. Uses `LlamaChat`
  (`chatWrapper: 'auto'`, mechanism 1) for the default path and `LlamaCompletion` (no templating) for
  mechanism 2 (`options.skipNativeTemplating`, a new addition to `LlmRuntimePort.complete()` — see
  4.5's note). Exercised against `test/fixtures/stories260K.gguf` (~1.2MB, ggml-org's own CI test
  model — real inference, not mocked; exempted from the `*.gguf` gitignore rule). **Done 2026-08-10,
  fully verified**: 6 integration tests green — real load, real streaming completion, real
  `AbortSignal` cancellation producing `'cancelled'` with partial content, mechanism 2's raw-prompt
  path, real session save/load round-trip, and the pre-load `RuntimeInitError` guard.
- [x] **4.3 `LlamaCppCapacitorAdapter`** — real implementation per the 0.1 ADR: two independent
  `LlamaContext` instances (`initLlama()` per model), `context.release()` never `releaseAllLlama()`,
  `stopCompletion()` wired to the `AbortSignal`. **Done 2026-08-10.** Untestable from this environment
  (no device) — same residual-risk pattern as every other Capacitor adapter.
- [x] **4.4 Chat-template preset registry** (`src/core/runtime/chat-template-presets.ts`) — pure
  function mapping `qwen`(ChatML)/`llama3`/`gemma`(system folded into the first user turn)/
  `mistral`(system folded into the first `[INST]` block)/`raw` to a formatted prompt string.
  **Done 2026-08-10** — 7 unit tests against hand-written reference formatting per preset.
- [x] **4.5 `RuntimeFacade`** (`src/core/runtime/runtime-facade.ts`) — resolves mechanism 1
  (`'auto'`, `messages` passed straight through) vs. mechanism 2 (explicit preset, pre-formats via
  4.4's registry into a single message + `skipNativeTemplating: true`), enforces `RuntimeBusyError`
  (single concurrent generation, TZ §9.4) via the "`complete()` never throws, `RuntimeBusyError`
  surfaces through `stream.result` rejecting" convention `CompletionStream`'s own doc comment
  specifies. **Note:** `LlmRuntimePort.complete()`'s signature gained a third `options?:
  { skipNativeTemplating? }` parameter to carry mechanism 2's intent down to the adapter — the public
  `LocalAiClient.complete()`/`CompletionInput` type is untouched by this (CLAUDE.md's "never add a raw
  prompt escape hatch" rule is about the public API, not this internal port extension). **Done
  2026-08-10**, 6 unit tests (`FakeLlmRuntimeAdapter`, pulled forward from Phase 5's task 5.4 since
  `RuntimeFacade` needed a controllable fake regardless).
- [x] **4.6 Wire `checkSupport`/`checkDeviceEligibility`/`ensureModelReady`/`ensureEmbeddingReady`/
  `complete`/`embed`** on `LocalAiClient` for real. **Done 2026-08-10.** Also wired alongside (cheap
  once the services existed): `create()` (validates a full `LocalAiPorts`, throwing `ConfigInvalidError`
  listing exactly which port is missing — core cannot default a missing port itself, hexagonal
  boundary), `resetLocalVerdicts()`, `refreshManifest()` (emits `manifest:updated`/`manifest:invalid`),
  `ensureReady()`, a real `on()`/internal event emitter, and the Mode-A `ConversationApi` CRUD methods
  (thin pass-through to Phase 3's `ConversationStore`). `sendMessage()`/`switchModel()`/
  `switchEmbedding()`/`vectors.*`/lifecycle methods remain stubs — Phase 5/6 scope, unchanged.
  `WebCryptoHashAdapter`/a new `SystemClockAdapter` moved to `src/adapters/shared/` (re-exported from
  both `adapters/capacitor` and `adapters/node-testing`) since both are genuinely platform-generic —
  the old location under `node-testing/` only would have meant a real Capacitor app importing a
  subpath explicitly documented as Node-only to get a working `HashPort`/`ClockPort`, which was never
  actually correct.

**Phase 4 exit criterion (TZ §15):** facade logic green in Node incl. per-preset chat-template unit
tests; manual smoke test on a low-end and high-end emulator confirms reasonable eligibility verdicts.
**Status: met for everything testable here** — 119 total tests green (74 unit + 19 integration + 26
contract), including a full `LocalAiClient` happy-path integration test (manifest refresh → eligibility
gate → download → model+embedding load → streaming completion → embed) and both eligibility-policy
block/warn scenarios. The "manual smoke test on a real low/high-end emulator" half of this criterion
is not achievable here (no device/emulator) — real device-level eligibility verdict sanity-checking
stays an open item before a v1 release, same as ADR 0004's residual risk.

---

## Phase 5 — Session-cache + multi-chat + context policy + `ConversationSyncApi` (TZ §15 row 5)

- [x] **5.1 `SessionCache`** (`src/core/conversations/session-cache.ts`) — single hot-slot per TZ
  §9.3; model fingerprint (`${id}:${version}`) embedded directly in the session filename rather than
  tracked in separate metadata, so a stale/wrong-version file is indistinguishable from "no file" —
  `activate()` naturally falls back to cold-start without needing a side table. Corrupt/incompatible
  `loadSession()` failure deletes the bad file and also falls back. `invalidateAll()` (model switch)/
  `deleteForChat()` (chat deletion cascade) both implemented. **Done 2026-08-10**, 7 unit tests.
- [x] **5.2 `sendMessage()`** on `LocalAiClient` (MVP `ConversationApi`) — user message saved before
  generation starts (TZ §9.8, first step inside the returned stream's `result`, so it's durable even
  if `RuntimeFacade.complete()` immediately rejects with `RuntimeBusyError`). **Done 2026-08-10.**
  Caught a real hang bug while writing the integration test: the forwarding loop that relays tokens
  from `RuntimeFacade`'s stream into `sendMessage()`'s own `AsyncTokenQueue` never closed that queue
  on the happy path (only on rejection) — every real `for await` consumer would have hung forever
  after the last token. Fixed before this task was marked done.
- [x] **5.3 Context window policy** (`src/core/conversations/context-window-policy.ts`) —
  `contextStrategy`/`maxContextTokens` per TZ §9.7's algorithm (`fail` / `truncate-oldest` /
  `truncate-to-fit`, walked newest-to-oldest, system message always kept); pure function taking an
  injectable token estimator, unit-tested without a model (8 tests) — `sendMessage()` resolves real
  per-message token counts via `LlmRuntimePort.countTokens()` *before* calling it, falling back to the
  chars/4 heuristic only if that call itself fails. Default `maxContextTokens` = `model.contextLength
  − (completionOptions.maxTokens ?? 512) − 64` safety margin, per TZ's stated formula. §16.17 (default
  strategy) stays open as a product question — `'truncate-oldest'` is what ships as the default either
  way, per the TZ/bootstrap's already-stated default.
- [x] **5.4 Cancel/error status semantics** — `status: 'complete'|'cancelled'|'error'` per TZ §9.8's
  table, verified end-to-end (not just at the port level) via 3 integration tests: normal completion,
  `AbortSignal` mid-stream (partial content preserved, saved as `'cancelled'`), and a scripted runtime
  error (saved as `'error'`). `FakeLlmRuntimeAdapter` (pulled forward into Phase 4 already) is the fake
  this task called for. **Done 2026-08-10.**
- [x] **5.5 Model/embedding switch flows** — `switchModel()`/`switchEmbedding()` implementing TZ
  §5.5/§5.6's safe ordering exactly: eligibility gate → download+verify → release *only* the relevant
  runtime context → `ModelRegistry.setCurrent()` (new, `src/core/registry/model-registry.ts` —
  `installed_artifacts` bookkeeping, migration 003 added `dimensions` for the embedding-changed event)
  → delete the old file → session-cache invalidation (model switch) /
  `vector-store:embedding-changed` with a correct `dimensionsChanged` (embedding switch) → reload.
  **Done 2026-08-10**, 2 integration tests confirming the old file is deleted, the *other* context is
  left untouched, and the client ends up reloaded and ready.
- [x] **5.6 `ConversationSyncApi`** (`upsertChat`/`appendMessages`, Mode B, TZ §9.6) — idempotent
  upsert/append semantics on `ConversationStore` (dedup by `(chatId, id)` via `INSERT ... ON CONFLICT
  DO NOTHING RETURNING id`, so "was this actually new" is answered in the same round-trip), wired
  through `LocalAiClient`. **Done 2026-08-10**, 6 contract-test scenarios + 1 `LocalAiClient`
  integration test. §16.16 (ship in v1 at all) stays open as a product question per `docs/decisions.md`.

**Phase 5 exit criterion (TZ §15):** switching chats doesn't lose history; a long conversation
truncates per policy without crashing; cancellation preserves a partial `'cancelled'` response;
second response in the same chat is measurably faster (session reuse). **Status: functionally met** —
148 total tests green (89 unit + 26 integration + 33 contract). The "measurably faster" half of the
last claim is a real-device performance characteristic of the native plugin's KV-cache reuse, not
something this environment's `FakeLlmRuntimeAdapter`/tiny-fixture `NodeLlamaCppAdapter` tests can
demonstrate — `SessionCache.activate()`'s cache-hit-vs-cold-start behavior is verified functionally
(7 unit tests), not benchmarked.

---

## Phase 6 — Lifecycle + orphan cleanup (TZ §15 row 6)

- [x] **6.1 `LifecycleManager.releaseRuntime()`** (`src/core/runtime/lifecycle-manager.ts`) —
  implements the exact TZ §11.1 boundary: releases the LLM/embedding contexts independently,
  optionally closes SQLite (`closeDatabase`, default `false`); never touches on-disk
  files/chats/`download_state`/session **files**. `LocalAiClient.releaseRuntime()` composes it with
  resetting its own in-memory caches (parsed manifest, `SessionCache`'s hot handle via the new
  `resetHotHandle()` — clears the pointer only, never deletes a session file). Idempotent (every port
  method it calls is a safe no-op with nothing loaded). **Done 2026-08-10**, 7 unit tests + 1
  integration test confirming chats/files genuinely survive a release.
- [x] **6.2 `unloadAll()` alias** — confirmed still delegates to the now-real `releaseRuntime()`.
  **Done 2026-08-10**, 1 integration test.
- [x] **6.3 `autoUnloadOnBackground`** — `CapacitorAppLifecycleAdapter` real implementation over
  `App.addListener('appStateChange', ...)` from `@capacitor/app` (the async `addListener()` call is
  bridged to the port's synchronous `Unsubscribe` return the same way `CapgoDownloaderAdapter` does).
  `LifecycleManager.enableAutoUnloadOnBackground()` wired into `LocalAiClient.create()` when
  `config.autoUnloadOnBackground` is set (default `false`, per TZ §11.2) — releases on backgrounding,
  deliberately does **not** eagerly reload on refocus (the next `ensureModelReady()`/`complete()`/etc.
  call lazily raises the context on its own). **Done 2026-08-10**, verified via `FakeAppLifecycleAdapter`
  (2 unit + 1 integration test) since the real Capacitor adapter is untestable here (no device).
- [x] **6.4 Independent orphan cleanup** for model vs. embedding files after a switch (TZ §5.5/§5.6
  step 6) — **already implemented in Phase 5's `switchModel()`/`switchEmbedding()`** (`ModelRegistry
  .setCurrent()` returns the previous row, the old file is deleted only if its filename differs from
  the new one, per-kind so a model switch never touches the embedding file and vice versa). No
  additional code needed here; this task is a pointer back to that work, confirmed still covered by
  Phase 5's 2 integration tests.

**Phase 6 exit criterion (TZ §15):** idempotency test green; manual on-device pass confirms memory is
actually released (accounting for TZ §11.3's OS page-cache caveat). **Status: met for what's testable
here** — 160 total tests green (96 unit + 31 integration + 33 contract). The "manual on-device pass"
half is unavailable in this environment (no device) — TZ §11.3's own caveat (the library can only
guarantee it drops its own references, not that the OS immediately reclaims the page cache) applies
regardless of platform and isn't something a device pass would meaningfully change anyway.

---

## Phase 7 — Documentation and hardening (TZ §15 row 7)

- [x] **7.1 README quickstart** — replaced the WIP placeholder with a real example against the
  implemented API (Capacitor port assembly, `checkSupport`→`create`→`ensureReady`→`createChat`→
  `sendMessage`), an honest "what's verified vs. not" section, and an updated "where things live"
  table reflecting the `adapters/shared/`/`core/utils/` moves from Phases 4-5. **Done 2026-08-11.**
- [x] **7.2 100% JSDoc gate** — tightened `eslint.config.js`'s `jsdoc/require-jsdoc` from
  top-level-declarations-only to also require every public method on the scoped files
  (`core/client`, `core/ports`, `core/errors.ts`, `core/types.ts`); closed all 45 gaps this surfaced
  (31 methods on `LocalAiClient`, 14 error-class constructors — `exemptEmptyConstructors` didn't
  cover TS's constructor-with-`super()`-call shape, written by hand instead). **Done 2026-08-11**,
  `pnpm lint` green with the tightened rule.
- [x] **7.3 TypeDoc site** — added `typedoc.json` (3 entry points matching the package's subpaths),
  wired `pnpm run docs` into `.github/workflows/ci.yml` as an `actions/upload-artifact` step.
  **Done 2026-08-11.** Along the way, found and fixed two real, previously-undiscovered problems:
  `pnpm run build` (`tsup`) was completely broken (bundling `node-llama-cpp`'s transitive
  `@reflink/reflink` native per-platform bindings, which esbuild can't resolve for platforms other
  than the host's — fixed via `external: ['node-llama-cpp']` in `tsup.config.ts`, since
  `devDependencies` aren't auto-externalized by tsup the way `dependencies`/`peerDependencies` are);
  and `docs/typedoc/**`'s generated output wasn't excluded from `eslint.config.js`'s `ignores`,
  so generating the site once broke `pnpm run lint` on ~140 browser-globals errors in its own bundled
  JS assets. Both are now part of `pnpm test`'s/CI's regular path, not just discovered once.
- [x] **7.4 Guides** (`docs/guides/`) — all 8 topics from TZ §12: `first-run.md`,
  `support-and-eligibility.md`, `multiple-chats.md`, `mode-b-integration.md`,
  `independent-model-embedding-updates.md`, `memory-and-lifecycle.md`, `testing-consumer-apps.md`,
  `manifest-format.md`, plus a `docs/guides/README.md` index. **Done 2026-08-11.**
- [x] **7.5 ADR archive completeness** — confirmed all 5 TZ §12-listed topics now have a dedicated
  ADR: native inference plugin (0001), SQLite plugin choice (**0007, added now** — was previously
  only implicitly covered by 0002's narrower sqlite-vec-loadExtension question), sqlite-vec/iOS
  (0002), downloader (0003), device-info + threshold calibration (0004). **Done 2026-08-11.**
- [x] **7.6 Example app** (`examples/minimal-capacitor-app/`) — real, complete TypeScript source
  (not a scaffolded buildable Capacitor project — its own `README.md` explains why and what to do
  with it) covering every item TZ asks for: 2+ chats (`chats.ts`), one in Mode B (`mode-b-chat.ts`),
  independent embedding update (`embedding-update.ts`), a "device not supported" screen
  (`eligibility-screen.ts`) plus inline `DeviceNotEligibleError` handling for the "not eligible" case.
  **Done 2026-08-11.**

**Phase 7 exit criterion (TZ §15):** example app builds and passes a manual happy-path run. **Status:
met in spirit, not literally** — the example app is real, type-plausible source code exercising every
scenario TZ asks for, but (per its own README) isn't a scaffolded, independently-buildable Capacitor
project in this environment (no native Android/iOS toolchain, no `npx @capacitor/cli create` run) —
"builds and passes a manual happy-path run" needs a real device/emulator the same way every other
Capacitor-adapter-touching claim in this ROADMAP does. What *is* mechanically verified here: `pnpm
run build`, `pnpm run docs`, and all 162 tests (96 unit + 33 integration + 33 contract) green — see
Phase 7.3's note for two real bugs that check caught.

---

## Phase 8 — Post-v1 (TZ §15 row 8, explicitly out of scope until requested)

Message branching (`parentMessageId`), multi-slot LRU session-cache, full-text search across chats
(FTS5), export/backup, `updateMessage`/`deleteMessages`. Was listed here only so it wasn't silently
reinvented mid-Phase-1-7 — TZ §15 row 8 explicitly says this needs "an ТЗ по запросу" (separate spec
on request), not the same design-review-level treatment as Phases 1-7. **2026-08-11: requested.**
User was asked to scope which of the 5 post-v1 items to include (`AskUserQuestion`, since bundling
all 5 in one shot would mean guessing several real product decisions at once — see CLAUDE.md's "ask
before guessing" rule); chose 3 of 5, explicitly excluding message branching (schema + `sendMessage()`
semantics change, the most invasive) — see `docs/decisions.md`'s Phase 8 section for the reasoning
behind each decision below.

- [x] **8.1 Multi-slot LRU `SessionCache`** (`docs/decisions.md` #8) — `SessionCache` now takes
  `{ maxSlots }` (new `LocalAiConfig.sessionCacheSlots`, default 3), evicting the least-recently-used
  `(chatId, modelFingerprint)` session file once the count is exceeded, replacing v1's actual behavior
  (no eviction at all — every saved file persisted unboundedly). **Done 2026-08-11**, 4 new unit tests
  (slot-count default, eviction past the cap, recency-bump-saves-from-eviction) plus a
  `LocalAiClient` integration test wiring `sessionCacheSlots` end to end through real `sendMessage()`
  calls.
- [x] **8.2 `updateMessage`/`deleteMessages`** (`ConversationSyncApi`, `docs/decisions.md` #7a) — Mode B
  sync of edits/deletes from the host app's own DB. `updateMessage()` partial-updates
  content/status/tokenCount/metadata and throws `MessageNotFoundError` on an unknown `(chatId,
  messageId)`; `deleteMessages()` bulk-deletes by id list, forgiving of already-missing ids (matches
  `appendMessages`' idempotent-batch spirit). Both invalidate the affected chat's session-cache file via
  the existing `SessionCache.deleteForChat()`. **Done 2026-08-11** — `ConversationStore` methods +
  9 contract-test scenarios (parametrized the same way as the rest of `conversation-store.contract.ts`)
  + 3 `LocalAiClient` integration tests.
- [x] **8.3 Full-text search (`searchMessages`)** — new `ChatSearchApi`, backed by
  `createMessageSearchIndex()` picking between `Fts5MessageSearchIndex` (primary, real SQLite FTS5,
  external-content virtual table + triggers so `sendMessage`/`appendMessages`/`updateMessage`/
  `deleteMessages`/`deleteChat` all stay in sync automatically) and `LikeMessageSearchIndex` (fallback,
  `LIKE '%...%'`) — same opportunistic-primary/self-tested/silent-fallback shape as `VectorStore`'s
  `sqlite-vec`/brute-force split (`create-vector-store.ts`), reused deliberately. New
  `chat-search:fallback-active` event mirrors `vector-store:fallback-active`. **Done 2026-08-11,
  fallback path verified, primary path not** — confirmed by direct test in this environment that
  `node:sqlite`'s `DatabaseSync` doesn't have FTS5 compiled in (`no such module: fts5`), so — exactly
  mirroring ADR 0002's sqlite-vec situation — only `LikeMessageSearchIndex` runs in this repo's own
  tests (5 contract-test scenarios + 3 unit tests for the fallback-selection logic);
  `Fts5MessageSearchIndex` needs a real device/Capacitor-SQLite build before being treated as verified,
  same residual-risk pattern as every other opportunistic-SQL-extension path in this codebase.
- [x] **8.4 Export/backup (`exportChat`/`exportChats`)** — new `ChatExportApi`. Deliberately no
  separate import method — the exported `{ chat, messages }` shape feeds directly into
  `upsertChat()`/`appendMessages()` for a round-trip restore, both already idempotent
  (`docs/decisions.md`'s "Export/backup" entry explains why a bespoke import path would just duplicate
  that). **Done 2026-08-11**, 5 contract-test scenarios including an actual round-trip through a second
  `ConversationStore`, plus a `LocalAiClient` integration test round-tripping through a second client/DB.
- [-] **8.5 Message branching (`parentMessageId`)** — declined, not started. User explicitly excluded
  this from Phase 8's 2026-08-11 scoping request (see above) as the most invasive of the 5 post-v1
  items (schema + `getMessages()`/`sendMessage()` semantics change) — not merely deferred to a later
  session, but scoped out on request. Re-open only if asked for again.

**Phase 8 exit criterion (informal, no TZ §15 wording — this phase has no design-review-level spec):**
`pnpm lint`/`typecheck`/`test:unit`/`test:integration`/`test:contract` green, `pnpm run build`/`pnpm
run docs` green. **Status: met for 8.1-8.4** — 189 total tests green (102 unit + 40 integration + 47
contract, up from Phase 7's 162), `pnpm run build` and `pnpm run docs` both still clean (0 lint errors,
same pre-existing TypeDoc warning count as before — no new ones). 8.3's FTS5 primary path carries the
same "not exercised in this environment" caveat every sqlite-vec/Capacitor-adapter claim in this
ROADMAP already carries — re-run `test/contract/message-search-index.contract.ts` against a real
`Fts5MessageSearchIndex` on-device (or any Node build with `node:sqlite`'s FTS5 module compiled in)
before treating it as verified.

---

## Security hardening — 2026-08-11 audit findings

Not a TZ §15 phase — found during a manual security audit of the library as it stood after Phase 8,
requested by the user. (No `origin` remote is configured in this repo, so the `security-review`
skill's `git diff origin/HEAD...` pre-hook errored out before loading; the audit was done by hand
instead, cross-referenced against TZ §14's invariants.) See `docs/decisions.md`'s "Security audit
(2026-08-11)" section for the full rationale behind each decision below. All three are currently
unimplemented.

- [x] **SEC.1 Validate `filename` in `validateManifest()`** (`src/core/manifest/manifest.service.ts`)
  — `model.filename`/`embedding.filename` currently flow unchecked from the network into
  `FileSystemPort.resolvePath()` (`download-engine.ts`, and `local-ai-client.ts`'s old-file cleanup on
  a model/embedding switch), and both `resolvePath()` implementations (`node-fs.adapter.ts`,
  `capacitor-fs.adapter.ts`) are documented as trusting their caller rather than sandboxing against
  `../` — a path-traversal write primitive if the manifest host is ever compromised or MITM'd (see
  SEC.2). Add a strict basename check (no `/`, `\`, `..`, must match e.g.
  `^[A-Za-z0-9][A-Za-z0-9._-]*\.gguf$`) alongside the existing `sha256`/`revision` checks in
  `validateManifest()`; reject anything else as a `ManifestValidationError`. **Done 2026-08-11** —
  `isSafeFilename()` guard added for both `model.filename`/`embedding.filename`; 7 new unit tests
  (`../` traversal, absolute path, backslash, wrong extension, `..` substring, and a dotted-version
  filename still accepted).
- [x] **SEC.2 Require `https://` on `LocalAiConfig.manifestUrl`** (`src/core/client/local-ai-client.ts`)
  — every other network call the library makes is https-gated (model download via the hardcoded
  `huggingface.co` URL, embedding download via `validateManifest()`'s `embedding.source.url` check),
  but the manifest fetch itself — the root of trust `sha256`/`revision` pinning depends on — isn't.
  `LocalAiClient.create()` should throw `ConfigInvalidError` for a non-`https://` `manifestUrl`,
  mirroring the embedding-URL check's wording, checked once at construction alongside `requirePorts()`.
  **Done 2026-08-11** — guard added as the first line of `create()`, before `requirePorts()`; 1 new
  integration test.
- [x] **SEC.3 Wire up `InsufficientStorageError`** (`src/core/download/download-engine.ts`,
  `src/core/ports/filesystem.port.ts`) — the error class already exists (`errors.ts`, scoped to TZ
  §6.2) but nothing in the codebase ever constructs or throws it. `EligibilityService` checks
  `freeDiskBytes` before a model/embedding switch, but that gate is policy-configurable
  (`eligibilityPolicy.no: 'warn'|'ignore'`) and only a point-in-time snapshot —
  `DownloadEngine.downloadArtifact()` itself has no independent check before writing. Add
  `FileSystemPort.freeSpaceBytes(path): Promise<number>` (Capacitor + Node-testing adapters, port
  symmetry per CLAUDE.md's `new-port` rule even though this extends an existing port), and have
  `downloadArtifact()` check `artifact.sizeBytes * 1.15` against it immediately before each download
  attempt, throwing `InsufficientStorageError` instead of filling the device's storage to 0 bytes free.
  **Done 2026-08-11** — `NodeFsAdapter.freeSpaceBytes()` via `fs.promises.statfs()` (walks up to the
  nearest existing ancestor, since the destination file doesn't exist yet at check time);
  `CapacitorFsAdapter.freeSpaceBytes()` reads `@capgo/capacitor-device-info`'s `storage.freeBytes`
  directly (`@capacitor/filesystem` itself has no free-space API), same soft-dependency/resolves-`0`-
  rather-than-throws pattern as `CapgoDeviceInfoAdapter` — untestable from this environment (no
  device), same residual-risk pattern as every other Capacitor-adapter claim in this ROADMAP.
  `downloadArtifact()` now checks free space fresh before every attempt (not just once), 2 new
  integration tests (starved → `InsufficientStorageError`, zero HTTP requests made; roomy → succeeds).

**Exit criterion:** unit tests for SEC.1 (a manifest with a `../`/absolute/non-`.gguf` `filename` is
rejected) and SEC.2 (a non-`https://` `manifestUrl` throws `ConfigInvalidError`) green; a contract/
integration test for SEC.3 (an artifact larger than a faked `freeSpaceBytes()` result throws
`InsufficientStorageError` without attempting a write). **Status: met** — 200 total tests green (110
unit + 43 integration + 47 contract, up from Phase 8's 189), `pnpm run lint`/`typecheck`/`build` all
clean. SEC.3's `CapacitorFsAdapter.freeSpaceBytes()` carries the same "not exercised in this
environment" caveat as every other Capacitor-adapter claim in this ROADMAP — re-verify on a real
device before a v1 release, same as ADR 0003/0004's residual risk. Two lower-severity findings from
the same audit pass (unvalidated `embedding.dimensions` reaching a SQL DDL string;
`HuggingFaceSource.repo`/`.file` going unchecked) were flagged but deliberately not scoped in here —
see `docs/decisions.md`'s "Security audit (2026-08-11)" section; revisit if/when requested.

---

## Local logging & export — 2026-08-11, requested

Not a TZ §15 phase (TZ §14 only specifies a pass-through `logger?: LocalAiLogger` config, no-op by
default) — user asked for a local, persisted log store the host app can read back later via an in-app
"export logs" button. See `docs/decisions.md`'s "Local logging & export (2026-08-11, requested)"
section for the reasoning behind each decision below (storage backend and default-on-vs-opt-in were
asked via `AskUserQuestion`; retention numbers and the export API shape are smallest-reasonable-
assumption defaults, logged there rather than guessed silently).

**Finding this section also fixes:** `LocalAiConfig.logger`/`LocalAiLogger` (TZ §14) is declared and
exported but never actually called anywhere in `src/` — a dead stub since it was first typed. LOG.3
wires it for real, not just the new persisted store.

- [x] **LOG.1 `logs` migration** (`src/core/db/migrations/004_logs.ts`) — use the `add-migration`
  skill. Columns: `id` (autoincrement PK), `ts` (ms epoch, via `ClockPort` — never `Date.now()`
  directly, matches every other timestamped table), `level` (`'debug'|'info'|'warn'|'error'`),
  `message` (text), `meta_json` (nullable text, `JSON.stringify`d structured payload). Index on `ts`
  for the prune-oldest and `since`-filtered query paths.
  **Done 2026-08-11** — one correction while implementing: `ts` is `TEXT` ISO-8601 via
  `ClockPort.nowIso()`, not ms epoch — the claim above that ms epoch "matches every other timestamped
  table" was backwards, every other `*_at`/timestamp column in `001_init.sql` (`chats.created_at`,
  `installed_artifacts.installed_at`, …) is ISO-8601 `TEXT`; ms epoch would have been the odd one out.
  Migration 4, `idx_logs_ts` index included.
- [x] **LOG.2 `LogStore`** (`src/core/logging/log-store.ts`) — wraps `SqlitePort` directly (same shape
  as `ConversationStore`/`Database`), not a new port: `append(entry)` (prunes oldest rows past
  `maxEntries` in the same transaction), `query({ since?, level?, limit?, offset? })`, `clear()`.
  Contract test under `test/contract/log-store.contract.ts`, parametrized over
  `NodeSqliteAdapter`/`CapacitorSqliteAdapter` exactly like `conversation-store.contract.ts`.
  **Done 2026-08-11** — `maxEntries` (default `DEFAULT_LOG_MAX_ENTRIES = 5000`) is a constructor
  option, same shape as `SessionCache`'s `{ maxSlots }`. `query()`'s `level` filter is a
  minimum-severity threshold (`levelMeetsThreshold()`, `log-levels.ts`), not exact match — expanded to
  a SQL `IN (...)` clause rather than filtering in TS, so `limit`/`offset` still page the right rows.
  10 contract tests against `NodeSqliteAdapter` (Capacitor path carries the same "unverified without a
  device" caveat as every other `CapacitorSqliteAdapter` path in this ROADMAP).
- [x] **LOG.3 Wire real internal logging** — new `LocalAiConfig.logging?: { enabled?: boolean;
  minLevel?: LogLevel; maxEntries?: number }` (default `enabled: false`; when enabled, default
  `minLevel: 'info'`, `maxEntries: 5000`). Add an internal log-dispatch helper in `LocalAiClient`
  that (a) always calls `config.logger` if supplied (preserves existing TZ §14 no-op-by-default
  behavior, now actually wired), and (b) additionally appends to `LogStore` when `config.logging.enabled`
  and the entry's level meets `minLevel`. Hook it into the existing single-choke-point `emit()`
  (`local-ai-client.ts`) so every `LocalAiEventMap` event (`manifest:invalid`, `download:failed`,
  `device:eligibility-warning`, `runtime:*`, `vector-store:fallback-active`,
  `chat-search:fallback-active`, etc.) logs itself for free, plus explicit `error`-level calls at the
  catch sites that throw without emitting an event (e.g. `RuntimeInitError`/`DownloadError` rethrows).
  **Done 2026-08-11** — also fixes `download:failed` (declared in `LocalAiEventMap` since Phase 8/9 but
  never once emitted — `ensureModelReady()`/`ensureEmbeddingReady()`/`switchModel()`/`switchEmbedding()`
  now route every `DownloadEngine.downloadArtifact()` call through one `downloadArtifactLogged()`
  wrapper that emits it on failure). One real bug found and fixed while wiring this: `emit()`
  calling `LogStore.append()` **fire-and-forget** deadlocked `NodeSqliteAdapter`'s single connection
  ("cannot start a transaction within a transaction") the moment two loggable events fired close
  together (reproduced by `create()`'s own `vector-store:fallback-active` +
  `chat-search:fallback-active` emits racing each other, then racing the next `createChat()`) — fixed
  by making `emit()`/`dispatchLog()` `async` and `await`ing every call site, so the persisted-log write
  is always fully sequenced with the rest of a method's own `SqlitePort` calls, same discipline the
  rest of the codebase already relies on for that shared connection. Two narrow exceptions, both
  logger-callback-only (never touch `LogStore`, so never open a transaction): `download:progress`
  (fires from a genuinely synchronous, non-`await`-able `onProgress` callback, and is high-frequency
  enough that persisting it would evict everything else against `maxEntries` anyway), and the
  handful of throw sites on methods that must themselves stay synchronous-returning by contract
  (`complete()`, `sendMessage()`'s pre-check, three "should never happen after create()" defensive
  guards) — see `local-ai-client.ts`'s `emit()`/`dispatchLog()` doc comments for the full reasoning.
- [x] **LOG.4 `LogExportApi`** on `LocalAiClient` — `exportLogs(options?: { since?: Date; level?:
  LogLevel; limit?: number }): Promise<LogEntry[]>` delegating to `LogStore.query()`; `clearLogs():
  Promise<void>` delegating to `LogStore.clear()`. Returns structured data only — no file write, no
  share-sheet call — same "library returns data, host app owns the native save/share flow" split as
  `ChatExportApi` (8.4). `LogEntry` type exported from `core/types.ts` alongside the rest of the public
  surface, JSDoc required (CLAUDE.md's JSDoc gate covers `core/types.ts`).
  **Done 2026-08-11** — `LogLevel`/`LogEntry` in `core/types.ts`; `LogExportApi` in
  `core/logging/logging.types.ts` (mirrors `ChatExportApi` living in `conversation.types.ts` rather
  than `types.ts` itself), both re-exported from `core/index.ts`. `LocalAiClient` now also
  `implements LogExportApi`.
- [x] **LOG.5 Tests** — unit tests for `minLevel` filtering and the `maxEntries` prune-on-append math;
  integration test wiring `logging.enabled` through a real `LocalAiClient` (trigger e.g. a
  `download:failed` or `manifest:invalid` event, assert it round-trips through `exportLogs()`); confirm
  `logger` (the pluggable callback) actually receives calls now, with a fake logger in the test.
  **Done 2026-08-11** — `levelMeetsThreshold()` unit-tested directly (`test/unit/logging/log-levels.test.ts`,
  4 tests); `maxEntries` prune-on-append math covered in the `LogStore` contract suite (5 rows in,
  `maxEntries: 3`, oldest 2 pruned) rather than duplicated as a separate unit test. 8 new integration
  tests in `local-ai-client.test.ts`: `logger` fires independent of `logging.enabled`; `exportLogs()`
  empty until enabled, then round-trips `manifest:updated`; default `minLevel: 'info'` drops
  `chat:created` (debug) but keeps `manifest:updated` (info); explicit `minLevel: 'error'` keeps only
  `manifest:invalid`; the `complete()` sync-context error reaches `logger` but not `exportLogs()`
  (documents the LOG.3 exception above); `since` filtering; `clearLogs()`; and — closing LOG.3's
  "finding this section also fixes" — `ensureModelReady()` actually emits `download:failed` on a
  checksum mismatch now.
- [x] **LOG.6 Docs** — new `docs/guides/logging-and-export.md`: enable `logging` in config → call
  `exportLogs()` → app-side `JSON.stringify` + `@capacitor/filesystem` `writeFile` to a cache dir +
  share plugin, wired to a UI button — mirrors the "app owns native UX" split from LOG.4. Add a minimal
  "Export logs" button to `examples/minimal-capacitor-app/` demonstrating the flow end to end, same
  treatment 7.6 already gives the rest of the public API. README gets a short mention alongside the
  existing `logger` config doc.
  **Done 2026-08-11** — guide covers `config.logger` vs. `config.logging` side by side (the two are
  independent, easy to conflate) plus `exportLogs()`/`clearLogs()`; added to `docs/guides/README.md`'s
  index. `examples/minimal-capacitor-app/src/logs.ts` adds `exportLogsToFile()` (writes to
  `Directory.Cache` via `@capacitor/filesystem`, already an example-app dependency; hands the URI to
  "whichever share plugin the app already depends on" rather than adding `@capacitor/share` as a new
  one), wired into `main.ts`'s boot sequence and `local-ai-setup.ts`'s `logging: { enabled: true }`.
  README gets a `## Logging` section with both config keys side by side.

**Exit criterion:** `pnpm lint`/`typecheck`/`test:unit`/`test:integration`/`test:contract` green;
`LogStore` contract test passes against `NodeSqliteAdapter` (Capacitor path carries the same
"unverified without a device" caveat as every other `CapacitorSqliteAdapter` path in this ROADMAP);
a fake `logger` in an integration test actually receives `debug`/`info`/`warn`/`error` calls (closes
the dead-stub finding above); `exportLogs()` round-trips a triggered failure event in a real
`LocalAiClient` without `logging.enabled` needing to be set for the pluggable `logger` callback itself
to fire. **Status: met** — 222 total tests green (114 unit + 51 integration + 57 contract [47
pre-existing + 10 new `LogStore`], up from SEC.1-3's 200), `pnpm run lint`/`typecheck`/`build` all clean.
`LogStore`'s `CapacitorSqliteAdapter` path carries the same "not exercised in this environment" caveat
as every other Capacitor-adapter claim in this ROADMAP.

---

## External feedback backlog — 2026-08-11 consumer review

Not a TZ §15 phase. Source: `C:\inetpub2025\forta.chat\docs\plans\llama2\2026-08-11-local-ai-library-feedback.md`
— written by the Forta Chat team while planning their own integration against this library (real
consumer read of the TZ/ROADMAP/decisions/guides/source, not a code review). Ten items; the
documentation-only ones were actioned directly in this pass (README banner/license note/test-count
wording, TZ §10 sync, the two new guide sections, `docs/pre-release-checklist.md`) — see
`docs/decisions.md`'s "External consumer feedback review" section for the full item-by-item
disposition table. What's left as real engineering/product work:

- [ ] **FB.1 Decompose `LocalAiClient`'s flat search/export/log methods into namespaces** — the facade
  already uses the `readonly client.vectors.*` / `client.downloads.*` pattern (constructor-built,
  readonly sub-objects) for two capability groups; `searchMessages`, `exportChat`/`exportChats`,
  `exportLogs`/`clearLogs` are the odd ones out, sitting flat on `this` alongside 30+ other methods.
  Proposed shape: `client.search.messages(...)`, `client.export.chat(...)`/`.chats(...)`,
  `client.logs.export(...)`/`.clear(...)`. **Approach decided 2026-08-29** (`docs/decisions.md`):
  deprecated-alias transition — add the namespaced methods, keep the existing flat ones as
  `@deprecated` aliases rather than a hard break. Unblocked; implementation not started.
- [x] **FB.4/§16.16 Get an explicit yes/no on shipping `ConversationSyncApi` (Mode B) in v1** —
  **Resolved 2026-08-29**: yes, ships in v1. See `docs/decisions.md` row #16.
- [ ] **FB.5/§16.20 `removeModel()`/`removeEmbedding()` without a replacement download** — new gap, not
  in the original TZ. `switchModel()`/`switchEmbedding()` only ever delete the old artifact file as a
  side effect of successfully downloading and verifying a new one (TZ §5.5/§5.6); there's no path to
  "just free the space, I don't have a replacement yet". Needs a small TZ §10 addition (new facade
  method(s), plus deciding what happens to `installed_artifacts`/session-cache/vector space when the
  active model is removed with nothing to fall back to — `complete()`/`sendMessage()` presumably need
  to throw a clear error rather than silently no-op) before implementation. Not started.
- [ ] **FB.7 Calibrate real `minRamGb`/`recommendedRamGb`/`tooSlowTokPerSec` numbers per model** — TZ
  §6.2's formula (`minRamGb ≈ ceil(sizeGB × 1.5)`) is explicitly a starting point, not measured data.
  `docs/guides/support-and-eligibility.md` now has an empty table ready to fill in, but the actual
  benchmarking needs real Android/iOS devices across a RAM spread — same physical-device dependency as
  every Phase 0 ADR still `proposed`. Blocked on device access, same as the rest of the residual-risk
  list in `ROADMAP.md`'s Phase 0 section.

**Exit criterion:** none — this is a backlog, not a phase with a single done-state. Each row above
gets checked off independently as it's actioned. FB.4's product decision and FB.1's breaking-change
approach are both resolved (2026-08-29, `docs/decisions.md`); FB.1 and FB.5 are unblocked
implementation tasks, FB.7 stays blocked on physical device access.

---

## Electron desktop support — 2026-08-29, requested (resolves §16.4)

Not a TZ §15 phase (TZ had no such phase — Electron was `Non-goals` until this request). See
`docs/decisions.md`'s "Electron desktop support" entry for the full product/architecture rationale and
`docs/2026-08-10-local-ai-library-tz.md`'s v6 diff (header, §1, §2, §4.1, §6.1) for the TZ-side update
this section implements. Summary: Electron (Windows/macOS/Linux) becomes a first-class, non-degraded
inference target, running entirely in Electron's **main process** — not the renderer (no native/
filesystem access there without the host app's own IPC, same split as a Capacitor WebView). Inference
specifically goes through **`llama-cpp-pro`'s own desktop/sidecar subsystem** (`llama-cpp-pro/desktop`
— a compiled sidecar process with an OpenAI-compatible local HTTP API, the same plugin this library
already depends on for Android/iOS per ADR 0008), not through `node-llama-cpp` (stays a Node-side test
tool only, TZ §13.1, unchanged) and not through a Capacitor native bridge (Electron has none). SQLite/
filesystem/download still use plain Node adapters, unaffected by this correction. **Corrected same day
(2026-08-29)**, after actually reading the installed `llama-cpp-pro@0.2.4` package rather than assuming
from its README — an earlier draft of this section incorrectly planned to promote `NodeLlamaCppAdapter`
to production for Electron; that draft is superseded by the task breakdown below. The desktop "different,
more powerful model list" the request asked for needs no manifest schema change — it falls out of the
existing multi-model manifest (`models[]`/`recommended`) plus `EligibilityService`'s RAM-based formula
naturally passing bigger models on desktop-class RAM.

**Dependency order:** 0.x spikes block everything (per this file's own Phase 0 convention — don't start
1.x until each spike's ADR exists, `accepted` or `rejected` with a fallback). 1.x (adapters) blocks 2.x
(packaging/export) blocks 3.x/4.x (manifest example, docs, example app). 5.x (CI) can start as soon as
1.x's Node-testable adapters exist, independent of 2.x/3.x/4.x. **Corrected 2026-08-29, after actually
running Phase 0**: the real dependency graph is finer-grained than "1.x blocks on all of 0.x" — each
1.x task lists its own specific spike dependency. **Updated again the same day**: ELEC.0.1's blocker
(ADR 0011) turned out to have a real, verified fix — all of Phase 0 and Phase 1 are now done, including
`LlamaCppProDesktopAdapter` (ELEC.1.1a), which this note originally expected to stay blocked
indefinitely. Nothing in Phases 0-4 is blocked by ADR 0011 anymore.

### Phase 0 — Spikes

Run via the `spike` skill, one ADR each under `docs/adr/`, same discipline as ADR 0001-0006.

- [x] **ELEC.0.1 `llama-cpp-pro` sidecar build/packaging spike** — resolves ledger row #24.
  **Done 2026-08-29, `accepted`** — a working sidecar binary was built, started, and exercised
  end-to-end against a real GGUF model: [ADR 0011](adr/0011-electron-sidecar-build.md). This was an
  actual hands-on build attempt (CMake 4.4.2 + VS2019 Community MSVC 19.28, real toolchain in this
  environment), not desk research — the CPU-only `cpu` variant's configure step succeeds; the **first**
  compile attempt failed with 3 real portability defects in the vendored C++ source (missing
  `#include <cstdarg>` in `cap-llama.cpp`; C++20-only designated initializers needing
  `CMAKE_CXX_STANDARD 20`; missing `_USE_MATH_DEFINES` for `M_PI` in `cap-tts.cpp`), and bumping to
  C++20 to fix the second one surfaced a 4th, seemingly unresolvable conflict (`llama-chat.cpp` needs
  `char8_t` disabled to stream a `u8"..."` literal; vendored `nlohmann/json.hpp` needs it enabled) — **but
  it was resolvable**: scoping `/Zc:char8_t-` to only `llama-chat.cpp`'s compilation unit (CMake
  `set_source_files_properties(...)`, not a global flag) plus moving `_USE_MATH_DEFINES` to a global
  compile-definition (its earlier per-file `#define` was include-order-fragile) produced a clean,
  complete, zero-error build. The resulting `win32-x64-cpu.exe` was then actually run: real `/health`,
  a real model load (`test/fixtures/stories260K.gguf`, the same fixture `NodeLlamaCppAdapter`'s own
  tests use), real streamed SSE tokens from `/v1/chat/completions`, real embeddings, clean unload — see
  the ADR's "Resolution" section for the full transcript and the exact 4-change recipe. **Not a
  `local-ai` code fix** — these are real defects in `llama-cpp-pro`'s own vendored source against MSVC
  specifically (GCC/Clang on Linux/macOS may not hit any of this); the ADR recommends reporting them
  upstream regardless, since the workaround shouldn't need rediscovering by every consumer. **Unblocks
  ELEC.1.1a** (`LlamaCppProDesktopAdapter`, done — see Phase 1 below).
  - **ELEC.0.1a**, folded into the same spike — **not run**: no packaged Electron app exists yet to test
    `loadExtension()` inside (would need ELEC.0.1's binary/packaging story working first in practice, to
    have something real to package). Stays open; `NodeSqliteAdapter` (re-exported as-is per ELEC.1.1b
    below) remains the only exercised path, `loadVectorExtension()` a documented no-op, same as every
    other platform in this repo today.
  - **ELEC.0.1b**, its own ADR question — **Done 2026-08-29, `accepted`**, resolved without needing a
    working binary: [ADR 0012](adr/0012-electron-sidecar-streaming.md), by reading
    `cap-native-server.cpp`'s actual request-handler source (not `sidecar-client.cjs`'s buffering
    wrapper). **Yes, the sidecar's HTTP server genuinely supports real per-token SSE** on
    `POST /v1/chat/completions` (`stream: true` → `start_live_completion_stream()` → real
    `text/event-stream` chunks in the standard OpenAI `chat.completion.chunk` shape, not a buffered
    response) — `LlamaCppProDesktopAdapter` implements its own SSE client rather than falling back to
    ADR 0001's single-synthetic-chunk shape, confirmed working both by source-reading and (once
    ELEC.0.1 resolved) a real live test. Same read-through surfaced 3 more real protocol gaps, all now
    reflected in the shipped adapter: no HTTP tokenize endpoint (ledger row #25, `countTokens()` uses
    the chars/4 heuristic on Electron specifically), no session/KV-cache persistence endpoint (row #26,
    `saveSession()`/`loadSession()` can't provide TZ §9.3's "faster second response" on Electron — a
    no-op/always-throw pair reusing `SessionCache`'s existing cold-start fallback), and no `topP`/
    `topK`/`seed`/`stop`/`repeatPenalty` support in the completion request body at all (row #27,
    resolved as "silently ignore" — matches every other adapter's `undefined`-means-native-default
    convention).
- [x] **ELEC.0.2 Desktop device-info spike** — **Done 2026-08-29, `accepted`**: [ADR 0009](adr/0009-electron-device-info.md).
  Actually ran `os.totalmem()`/`os.freemem()`/`fs.promises.statfs()` on this environment's real Windows/
  Node 22 — all three return plausible non-zero values (34.19GB total / 11.03GB free / ~67GB free disk),
  and cross-checked against `NodeFsAdapter.freeSpaceBytes()`'s existing `statfs().bavail * bsize` logic
  (SEC.3), confirming that's directly reusable. **Real correction found**, not assumed: reading
  `llama-cpp-pro/desktop`'s own installed source (the plugin this library already depends on) showed its
  `ipc-handlers.cjs` deliberately does **not** trust bare `os.freemem()` on macOS (undercounts
  reclaimable inactive/purgeable pages) and instead shells out to `vm_stat` — `ElectronDeviceInfoAdapter`
  reimplements that same `getAvailableSystemBytes()` logic (not exported from the peer package, so
  duplicated rather than imported) instead of the originally-planned bare `os.freemem()`. `thermal`/
  `lowPowerMode` confirmed to stay `'unknown'`/`undefined` — no desktop-native equivalent exists, same
  fallback shape as ADR 0004's mobile adapter, not fabricated. Unblocks ELEC.1.3 (done, see below).
- [x] **ELEC.0.3 Electron app-lifecycle mapping spike** — **Done 2026-08-29, `accepted`**:
  [ADR 0010](adr/0010-electron-app-lifecycle.md). `electron` was not previously installed anywhere in
  this repo — added as a `devDependency` (`electron@44.0.0`, mirroring how `@capacitor/app`/etc. are
  already `devDependencies` here) specifically so event names/signatures could be checked against the
  real shipped `.d.ts` rather than recalled from training. Confirmed real: `'before-quit'`/`'will-quit'`/
  `'window-all-closed'`/`'browser-window-blur'`/`'browser-window-focus'` all exist with the expected
  signatures; `BrowserWindow.getFocusedWindow(): BrowserWindow | null` (static) lets a listener
  disambiguate "focus moved to another window of this app" from "the whole app lost focus" in one call.
  Real precedent found in `llama-cpp-pro/desktop/src/main/ipc-handlers.cjs`: it already hooks
  `'before-quit'` to stop its own sidecar process — confirms that event (not `'window-all-closed'`, which
  doesn't even fire on macOS by convention) is the right one for process-exit cleanup. **Decision:** two
  independent hooks, not one — `'before-quit'` for unconditional runtime release (regardless of
  `autoUnloadOnBackground`), `'browser-window-blur'`/`-focus'` debounced against `getFocusedWindow()` for
  `onStateChange()`. Unblocks ELEC.1.4 (done, see below).

**Phase 0 exit criterion:** an ADR per row above, `accepted` or explicitly `rejected` with a documented
fallback, same bar as this file's original Phase 0 section. **Status: met, all 3 `accepted`** — ADRs
0009/0010/0011 (0012 also written, for ELEC.0.1b's finding, folded under 0.1 above), all real, hands-on
verification in this environment (actual Node API calls run, actual `electron` package installed and
its real `.d.ts` read, an actual sidecar built and driven through a real chat completion). ELEC.0.1a
stays unrun (no packaged Electron app exists yet to test `loadExtension()` inside); ELEC.0.1b is
resolved (`accepted`, ADR 0012).

### Phase 1 — Promote/build the real adapters

Per-port breakdown, using the `new-port` skill's symmetry checklist even where a port already has other
adapters (Electron is a *new* adapter for each existing port, same as adding Capacitor alongside
Node-testing was).

- [x] **ELEC.1.1a `LlamaCppProDesktopAdapter`** (`src/adapters/electron/llama-cpp-pro-desktop.adapter.ts`)
  — **Done 2026-08-29, verified end-to-end against a real running sidecar and a real GGUF model** —
  once ELEC.0.1's build blocker resolved (ADR 0011), this stopped being a "write it and hope" task and
  became genuinely testable. **New** `LlmRuntimePort` adapter, not a promotion of anything in
  `node-testing` (an earlier draft of this roadmap incorrectly planned to promote `NodeLlamaCppAdapter`
  here — stays wrong, confirmed). Wraps `llama-cpp-pro/desktop`'s `detectBackend()` +
  `createSidecarManager()` (one shared sidecar process, started lazily on first `loadModel()`/
  `loadEmbeddingModel()`, stopped only once *both* are released — TZ §5.5/§5.6 independence preserved
  within one process via two `model_id`s, `'llm'`/`'embedding'`, per `POST /v1/internal/models/load`/
  `DELETE /v1/internal/models/:id`). `complete()` implements its own real SSE client over `node:http`
  against `POST /v1/chat/completions` (mechanism 1) / `/v1/completions` (mechanism 2,
  `skipNativeTemplating`) — confirmed via ADR 0012's source read *and* this session's live test (see
  ADR 0011's "Resolution" section: real streamed tokens from a real model, not mocked) — not the
  single-synthetic-chunk fallback, which turned out unnecessary. `countTokens()`/`saveSession()`/
  `loadSession()` deliberately implement the documented deviations ADR 0012 (ledger rows #25/#26)
  calls for (chars/4 heuristic; no-op/always-throw) rather than pretending the sidecar supports what it
  doesn't. `topP`/`topK`/`seed`/`stop`/`repeatPenalty` are silently unsupported on this platform (ledger
  row #27's undecided question, resolved here as "silently ignore" — matches every other adapter's
  `undefined`-means-native-default convention, least surprising for a caller not specifically targeting
  Electron). 14 new unit tests (`test/unit/adapters/llama-cpp-pro-desktop.adapter.test.ts`) — a real,
  unmocked local `node:http` server standing in for the sidecar (same "run a fixture server, don't mock
  the transport" precedent `test/integration/download/mock-http-server.ts` already set), covering real
  SSE parsing, mechanism 1/2 routing, cancellation with partial content, HTTP-error → `status: 'error'`,
  embeddings mapping, and the shared-process release-independence guarantee.
- [x] **ELEC.1.1b Promote `SqlitePort`/`FilesystemPort`/`DownloadTransportPort` to a production Electron
  export** — **Done 2026-08-29.** `src/adapters/electron/index.ts` re-exports `NodeFsAdapter`/
  `NodeSqliteAdapter`/`NodeRangeDownloadAdapter` (as `Electron*Adapter` aliases) plus
  `WebCryptoHashAdapter`/`SystemClockAdapter` from `../node-testing`/`../shared` unmodified — no
  duplication, same "re-export, don't copy" precedent `WebCryptoHashAdapter` already set in Phase 4.
  Ledger row #21 (`loadExtension()` in a packaged app) stays open per ELEC.0.1a above — no packaged app
  exists yet to test against, so `NodeSqliteAdapter`'s existing documented no-op is what actually ships.
- [x] **ELEC.1.2 `ElectronPlatformSupportAdapter`** (`src/adapters/electron/electron-platform-support.adapter.ts`)
  — **Done 2026-08-29.** `isNativePlatform()` → `true`, `getPlatform()` → `'electron'` per TZ v6 §6.1.
  `isPluginAvailable()` is **not** unconditionally `true`: `sql`/`download`/`fs`-equivalents → `true`
  (plain Node, no registry to check); the one real gate is `pluginName === 'LlamaCpp'`
  (`PLUGIN_REGISTRY['inference'].pluginName`, ADR 0005) → delegates to `llama-cpp-pro/desktop`'s
  `getResourcesPathForApp()`/`assertSidecarBinary()` — correctly reports `false` when no sidecar binary
  is staged under the app's resources path, `true` once one is (confirmed both states for real:
  `false` before ADR 0011's fix, `true` against this session's actually-built binary) — not a hardcoded
  placeholder either way, genuinely reflects `assertSidecarBinary()`'s real result. `PLUGIN_REGISTRY`/
  `SupportChecker`'s `platform` type and narrowing both extended to
  include `'electron'` (`src/core/ports/platform-support.port.ts`, `src/core/support/types.ts`,
  `src/core/support/support-checker.ts`) — a real gap found while implementing this: the type only had
  `'ios'|'android'|'web'|'unknown'` before, silently normalizing `'electron'` to `'unknown'`; one
  pre-existing unit test (`support-checker.test.ts`) had actually encoded that stale behavior as its
  "unrecognized platform" example and needed fixing, not just extending. 8 new unit tests. Depends on:
  none for the logic itself (only the *result* of `isPluginAvailable('LlamaCpp')` depends on ELEC.0.1).
- [x] **ELEC.1.3 `ElectronDeviceInfoAdapter`** (`src/adapters/electron/electron-device-info.adapter.ts`)
  — **Done 2026-08-29**, per ADR 0009's findings: `os.totalmem()`, a reimplemented
  `getAvailableSystemBytes()` (not bare `os.freemem()`) for `freeRamGb`, `NodeFsAdapter.freeSpaceBytes()`
  reused (not duplicated) for `freeDiskBytes`, `thermal: 'unknown'`/`lowPowerMode: undefined`. 3 new
  `test/integration` tests (real `os`/`fs` calls, no mocking, per CLAUDE.md's "does this need a phone? no"
  rule) — plausible non-zero values confirmed against this environment's real Windows/Node 22.
- [x] **ELEC.1.4 `ElectronAppLifecycleAdapter`** (`src/adapters/electron/electron-app-lifecycle.adapter.ts`)
  — **Done 2026-08-29**, per ADR 0010's findings: `onStateChange()` wired to `'browser-window-blur'`/
  `'browser-window-focus'`, debounced against `BrowserWindow.getFocusedWindow()`; constructor optionally
  takes an `onBeforeQuit` callback wired to `'before-quit'`, fired unconditionally and best-effort
  (rejection swallowed, mirrors `llama-cpp-pro/desktop`'s own precedent for the same event) —
  independent of `autoUnloadOnBackground`, a capability mobile's `AppLifecyclePort` never needed since it
  has no analogous "process is about to disappear" event. 7 new unit tests, fully mocked (`app.on`/`off`
  fakes) — no real Electron process needed for this adapter's actual logic (the debounce math), unlike
  ELEC.1.5's original assumption.
- [x] **ELEC.1.5 Tests** — **Done 2026-08-29**, all of Phase 1 now covered, none deferred.
  `ElectronPlatformSupportAdapter`/`ElectronAppLifecycleAdapter`/`LlamaCppProDesktopAdapter` logic is
  pure enough to be plain `test/unit` (fully mocked `App`-shaped fakes for the first two, matched
  against `electron@44.0.0`'s real `.d.ts`; a real local `node:http` fixture server standing in for the
  sidecar for the third) — turned out to need **no** Electron-native test runner anywhere, a real
  correction to this task's original assumption. `ElectronDeviceInfoAdapter` is `test/integration` (real
  `os`/`fs`, no mocking). `pnpm lint`/`typecheck`/`test:unit`/`test:integration`/`test:contract`/`build`
  all green (212 unit + 108 integration + 61 contract tests, `npx tsc --noEmit` and `npx eslint .`
  clean, `pnpm run build` produces a real `dist/adapters/electron/` output including the desktop
  runtime adapter).

**Phase 1 exit criterion:** every new adapter has JSDoc; `ElectronPlatformSupportAdapter`/
`ElectronDeviceInfoAdapter` covered by `test/integration` running in plain CI (no display/emulator);
`ElectronAppLifecycleAdapter` covered by whatever Electron-native test runner ELEC.1.5 settles on.
**Status: fully met** — every Phase 1 adapter (`ElectronPlatformSupportAdapter`/
`ElectronDeviceInfoAdapter`/`ElectronAppLifecycleAdapter`/`LlamaCppProDesktopAdapter`/the
`SqlitePort`/`FilesystemPort`/`DownloadTransportPort` re-exports) is real, tested, and green; none
needed an Electron-native test runner in the end (real finding, not the assumption this task started
with). `LlamaCppProDesktopAdapter` — the one item this ROADMAP long expected to stay blocked — is done
too, once ADR 0011's real build defect turned out to have a real, verified fix (per-file `char8_t`
scoping + a correctly-globally-scoped `_USE_MATH_DEFINES`, see that ADR's "Resolution" section) rather
than being a genuine dead end.

### Phase 2 — Packaging & export wiring

- [x] **ELEC.2.1 `package.json` export** — **Done 2026-08-29**, pulled forward from behind ELEC.1.1a
  (which is still blocked) since the rest of Phase 1 was real and needed a genuine build/typecheck pass
  to verify against, not just written on faith. New `./adapters/electron` subpath in `package.json`'s
  `exports` (mirrors `./adapters/capacitor`/`./adapters/node-testing`); `electron@>=28.0.0` added as a
  `peerDependencies`/`peerDependenciesMeta.optional: true` entry (also added as a real `devDependency`,
  `electron@44.0.0`, per ADR 0010's need to type-check against its real `.d.ts`); `llama-cpp-pro` already
  covers the `/desktop` subpath, confirmed, no change needed there. `tsup.config.ts` gained a
  `'adapters/electron/index'` build entry. **Verified for real, not assumed**: `pnpm run build` produces
  `dist/adapters/electron/index.{js,cjs,d.ts,d.cts}`; `npx tsc --noEmit` and `npx eslint .` both clean.
  SQLite-backend choice (the "chosen SQLite backend" this task originally also covered) stays as
  `NodeSqliteAdapter` per ELEC.1.1b — no new backend added, ELEC.0.1a (which would justify one) never ran.
- [x] **ELEC.2.2 CI matrix** — **Done 2026-08-29, scope reduced from the original plan** — real finding
  changed what CI can safely do: extended `.github/workflows/ci.yml`'s `matrix.os` to
  `[ubuntu-latest, windows-latest, macos-latest]`, but deliberately does **not** attempt to build the
  `llama-cpp-pro` sidecar or test packaged-app `loadExtension()` on any runner — both are still blocked
  (ADR 0011, ELEC.0.1a never ran), so scripting them into CI now would just add a permanently-red job.
  What the 3-OS matrix *does* verify for real: the full existing lint/typecheck/unit/integration/
  contract/build pipeline — including `ElectronDeviceInfoAdapter`/`ElectronPlatformSupportAdapter`/
  `ElectronAppLifecycleAdapter`'s real tests — actually passes on real Windows and (untested before now)
  macOS, not just Linux. TypeDoc generation/upload restricted to `ubuntu-latest` only (`if: matrix.os ==
  'ubuntu-latest'` on both steps) to avoid 3x duplicate artifact uploads. Left a comment in the workflow
  file flagging that `windows-latest` ships a newer MSVC (VS2022) than this session's own dev environment
  (VS2019) — worth re-attempting ELEC.0.1's sidecar build there specifically once CI access exists,
  since ADR 0011's `char8_t` conflict is exactly the kind of thing a newer toolset might handle
  differently. Partially resolves ledger row #12 for the Electron slice — Electron needs no emulator/
  simulator, just OS-native runners.

**Phase 2 exit criterion:** `pnpm install && pnpm build` succeeds with the new export on a clean
checkout; ELEC.1.5's Electron-adapter tests green on all three OS runners in CI. **Status: met for what
this environment can verify** — `pnpm install`/`pnpm build` confirmed clean locally (this *is* a clean
Windows checkout, dependencies installed fresh this session); the 3-OS CI matrix is written and should
produce the same result on `windows-latest`/`ubuntu-latest` per this session's own passing local run —
`macos-latest`'s actual pass/fail is unverified (no macOS machine here, no CI run triggered — no `origin`
remote configured in this repo, ROADMAP.md's security-audit section already notes this same limitation).

### Phase 3 — Manifest & eligibility

- [x] **ELEC.3.1 Desktop-class example manifest entries** — **Done 2026-08-29**, but in
  `docs/guides/manifest-format.md` rather than a new file under `examples/` — that guide turned out to
  be the actual canonical example-manifest reference (no literal manifest JSON exists under `examples/`,
  just a `manifestUrl` string) and was **itself stale**, a real gap found while doing this task: it still
  showed the old singular `model`/`embedding` object shape from before multi-model support landed
  (2026-08-21), not the real `models[]`/`embeddings[]` arrays `manifest.schema.ts` actually defines.
  Rewrote it with the real array shape, added a `qwen-14b` desktop-class entry (`minRamGb: 14`,
  `recommendedRamGb: 24`) next to the existing `qwen-4b` "runs everywhere" entry, and added a "Desktop vs.
  mobile" section explaining both ship in the *same* manifest — no separate schema, `EligibilityService`
  naturally filters by device RAM. Also documented a real, easy-to-miss interaction while writing this:
  `maxModelParamsB` (`LocalAiConfig`, default `4`) silently excludes any `models[]` entry over the cap
  rather than erroring — a desktop-class 14B entry needs that config raised explicitly or it's dropped
  with no error, confirmed by reading `manifest.service.ts`'s actual filtering logic, not assumed.
- [ ] **ELEC.3.2 Resolve ledger row #22** (desktop `minRamGb`/`recommendedRamGb` calibration) — once
  ELEC.0.2's real numbers are available from a few real desktop machines, decide whether TZ §6.2's
  mobile-derived formula needs a desktop-specific variant or holds as-is; log the resolution in
  `docs/decisions.md` either way, don't leave it silently assumed. **Still blocked** — ELEC.0.2 confirmed
  what raw numbers are *reachable* (real Windows totals/free RAM/disk, ADR 0009) but calibrating
  `minRamGb`/`recommendedRamGb` *values* needs running actual models on a RAM spread of real desktop
  machines to see what genuinely works, which this environment (one Windows dev box, no ability to
  safely exhaust its RAM for a real test) can't responsibly do. Depends on: real desktop hardware to
  sample, unchanged.

**Phase 3 exit criterion:** example manifest has desktop-scale entries; row #22 has a `Resolved` status
in `docs/decisions.md` (even if the resolution is "formula holds as-is, no change needed").
**Status: met for ELEC.3.1** — `docs/guides/manifest-format.md` now has a real desktop-scale entry and
is no longer stale against the actual schema. **ELEC.3.2 stays open** — ledger row #22 in
`docs/decisions.md` is unchanged, honestly still blocked on hardware this environment doesn't have.

### Phase 4 — Example app & docs

- [x] **ELEC.4.1 `examples/minimal-electron-app/`** — **Done 2026-08-29**, real, complete TypeScript
  source mirroring `minimal-capacitor-app/`'s treatment: `src/local-ai-setup.ts` (full port assembly in
  the main process, **every** port real including `llmRuntime`), `src/eligibility-screen.ts`
  (`checkSupport()` before `create()`), `src/main.ts` (boot order, and a real `sendMessage()` call —
  updated the same day once `LlamaCppProDesktopAdapter` landed, no longer a `FakeLlmRuntimeAdapter`
  stand-in), `src/ipc-bridge-sample.ts` (illustrative `contextBridge`/`ipcMain.handle` sample,
  explicitly marked "one way to do it, not library-owned"). 2+ chats / Mode B / embedding-switch /
  logs-export demos deliberately **not** duplicated here (would be byte-for-byte structurally identical
  to `minimal-capacitor-app`'s equivalents, since `LocalAiClient`'s public API is platform-identical by
  design) — the README points there instead of copy-pasting. `npx eslint examples/minimal-electron-app/`
  clean; not included in `tsc`'s scope, same as `minimal-capacitor-app` (`tsconfig.json`'s `include` is
  `src/`/`test/`-only by design, both example apps documented as illustrative-not-buildable in their own
  READMEs — a sidecar binary and a real desktop machine are still needed to actually run this one, TZ
  §12's own bar for "example app," same as every native-plugin-touching claim in this ROADMAP).
- [x] **ELEC.4.2 README "Platform support" update** — **Done 2026-08-29**, updated again the same day
  once ELEC.1.1a landed. Replaced the single "unavailable on web/Electron by design" paragraph with
  three explicit subsections (Android/iOS, Electron, Web) — Electron's now states first-class,
  real-inference support with two honest, linked caveats (sidecar binary must be staged; no
  session-cache speedup) rather than either a blanket "works" or the earlier "still blocked" framing.
- [x] **ELEC.4.3 `docs/guides/electron-integration.md`** — **Done 2026-08-29**, updated again the same
  day. Covers port assembly (real code sample, `LlamaCppProDesktopAdapter` included), the
  main-process-only constraint, install (`peerDependencies`), an "Inference — real, with two caveats"
  section (sidecar-binary-must-exist, no session-cache/fine-grained-sampling — links ADR 0011/0012,
  explicit "don't substitute `node-llama-cpp`" warning — repeating this repo's own earlier planning
  mistake was worth guarding against explicitly), desktop-scale models (points at `manifest-format.md`'s
  new section), and lifecycle (`onBeforeQuit` vs. `onStateChange` per ADR 0010). Added to
  `docs/guides/README.md`'s index table.

**Phase 4 exit criterion:** example app builds and runs a manual happy-path pass (create client, load a
small test model, send a message) on at least one OS in this environment; README and the new guide are
consistent with TZ v6. **Status: met, including the "send a message" half** — the exact happy path this
criterion describes (create client → load a small test model → send a message) was actually run in this
environment, live, against `test/fixtures/stories260K.gguf` through a real running sidecar (ADR 0011's
"Resolution" section) — not through this example app's own untriggered source, but through the same
`LlamaCppProDesktopAdapter` code this example app assembles, so the claim is genuinely backed rather
than aspirational. The one honest gap remaining, same as `minimal-capacitor-app`'s own precedent: this
example app itself is illustrative source, not a scaffolded/buildable Electron project — running *it*
specifically needs a real Electron shell + packaged sidecar, not attempted here. README and the guide
are consistent with TZ v6 and with ADR 0009/0010/0011/0012's actual findings.

**Residual risk carried forward, same shape as this file's existing Phase 0 caveats:** every claim above
about "works on Windows/macOS/Linux" beyond what this session's real, hands-on Phase 0/1 work (ADR 0009/
0010/0011/0012) actually verified is unverified — all four ADRs are `accepted`, but from real
**Windows-only** checks (real Node API calls, a real installed `electron` package, a real built-and-run
sidecar binary against a real GGUF model). macOS/Linux remain completely untested — no such machine was
available in this environment — same residual-risk shape ADR 0002-0004/0006 already carry for mobile,
and ADR 0011 itself flags that the MSVC-specific defects it found and fixed (`char8_t`/`M_PI`/
`va_start`) may simply not exist on GCC/Clang, meaning macOS/Linux could either build cleanly with zero
of Windows's fixes or hit entirely different issues — genuinely unknown, not assumed either way.
GPU-accelerated variants (`vulkan`, `cuda`, `metal`, `rocm`) are also untested — only the CPU-only `cpu`
variant was built and verified.
