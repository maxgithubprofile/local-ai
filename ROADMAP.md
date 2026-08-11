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

Depends on: 0.1 (`llama-cpp-capacitor` API), 0.4 (device-info), 1.3/1.4 (support/eligibility).

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
