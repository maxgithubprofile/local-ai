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
| 7 | Message branching (regenerate/edit-and-resubmit) in v1 | Open | User scoped Phase 8's 2026-08-11 request to exclude this — most invasive of the Phase 8 set (schema + `getMessages()`/`sendMessage()` semantics change), stays deferred until asked for explicitly | 2026-08-11 | — |
| 7a | Syncing edits/deletes of individual messages from the host app's own DB (Mode B) | Resolved | Implemented as `ConversationSyncApi.updateMessage()`/`deleteMessages()` (Phase 8). `updateMessage()` throws `MessageNotFoundError` if `(chatId, messageId)` doesn't exist (an explicit sync call on a known id going missing is a real drift bug, not something to swallow silently, unlike `appendMessages`' dedup-by-existing which is expected/routine). `deleteMessages()` is forgiving — unknown ids simply don't count towards `deleted`, since bulk delete-sync is expected to be called with possibly-stale id lists. Both invalidate the affected chat's session-cache file (content changed under it) via the same `SessionCache.deleteForChat()` used by `deleteChat()`. | 2026-08-11 | — |
| 8 | Multi-slot session-cache vs. single-slot for v1 | Resolved | v1 shipped single-conceptual-slot (in-process hot pointer) but with **no eviction at all** — every chat's session file already persisted unboundedly once saved (see `session-cache.test.ts`'s pre-Phase-8 behavior). Phase 8 replaces that with a real bounded LRU: `SessionCache` takes `{ maxSlots }` (new `LocalAiConfig.sessionCacheSlots`, default **3** — smallest-reasonable-assumption product default, revisit if usage data suggests otherwise), evicting (deleting) the least-recently-touched `(chatId, modelFingerprint)` session file once the count exceeds it. LRU order is tracked in-process only — session files already on disk from an earlier process aren't retroactively ordered (no mtime on `FileSystemPort.stat()` to reconstruct recency), so a fresh process only starts evicting once it has itself touched `maxSlots + 1` distinct slots; pre-existing untouched files are harmless (sessions are derived/rebuildable, TZ §9.3) and get reclaimed by `deleteForChat()`/`invalidateAll()` regardless. | 2026-08-11 | — |
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
| 20 | A method to free storage by removing the currently-installed model/embedding **without** downloading a replacement (`switchModel()`/`switchEmbedding()` only delete the old file as a side effect of fetching a new one) | Open | Raised by external consumer feedback (`2026-08-11-local-ai-library-feedback.md` #6, from the Forta Chat integration) — realistic mobile scenario (user wants the 2.5GB back with no replacement in hand). Not implemented; see `ROADMAP.md`'s "External feedback backlog" section, task FB.5 | 2026-08-11 | — |

## How to resolve a row

1. Get the decision (from the user, or a Phase 0 spike via the `spike` skill).
2. Update `Status` → `Resolved`, fill `Resolution`/`Date`, link an ADR under `docs/adr/` if the
   resolution came from a spike or has non-trivial consequences.
3. If code already encodes the old placeholder assumption, update it in the same change — don't
   leave the ledger and the code disagreeing.

## Phase 8 decisions (not TZ §16-numbered — TZ §9.5/§15 row 8 flagged these for "отдельное ТЗ по запросу" rather than giving them their own §16 numbers)

User scoped the 2026-08-11 Phase 8 request to: multi-slot LRU session-cache (#8 above), `updateMessage`/`deleteMessages` (#7a above), and full-text search + export/backup (this section) — explicitly **excluding** message branching (#7, stays open).

### Full-text search (`searchMessages`)

**Decision:** primary path is real SQLite FTS5 (external-content virtual table `chat_messages_fts` over `chat_messages`, kept in sync via `AFTER INSERT/UPDATE/DELETE` triggers so `updateMessage`/`deleteMessages`/`deleteChat` all stay consistent automatically), with a `LIKE`-based brute-force fallback — same opportunistic-primary/self-tested/silent-fallback shape as `VectorStore`'s `sqlite-vec`/brute-force split (`create-vector-store.ts`), reusing that pattern deliberately rather than inventing a new one. New `chat-search:fallback-active` event mirrors `vector-store:fallback-active`.

**Why not a numbered migration:** confirmed by direct test in this environment — `node:sqlite`'s `DatabaseSync` (Node 22.12.0, `--experimental-sqlite`) does **not** have FTS5 compiled in (`CREATE VIRTUAL TABLE ... USING fts5(...)` throws `no such module: fts5`). A migration that assumes FTS5 would break `Database.migrate()` — and therefore the entire library, not just search — on any environment lacking it. So, like `vec0`, the FTS5 table/triggers are created lazily and self-tested (`createMessageSearchIndex()`, mirrors `createVectorStore()`), never inside `MIGRATIONS`. This repo's own Node tests exercise only the `LIKE` fallback path, exactly mirroring `VectorStore`'s residual-risk pattern (ADR 0002) — the FTS5 path needs real-device/Capacitor-SQLite confirmation before being treated as verified.

### Export/backup (`exportChat`/`exportChats`)

**Decision:** deliberately **no separate import method**. `exportChat()`/`exportChats()` return `{ chat, messages }` shaped exactly as `upsertChat()`'s input + `appendMessages()`'s input — round-tripping a backup is `upsertChat(exported.chat)` + `appendMessages(exported.chatId, exported.messages)`, both already idempotent. Building a bespoke import path would duplicate logic `ConversationSyncApi` already provides for the identical shape. No file/DB-level raw backup (e.g. copying the SQLite file) — TZ never specifies one, JSON-shaped export is the smallest reasonable interpretation of "export/backup" that composes with what already exists, and it's the same reasoning as this row's "least specified" flag when the user was asked to scope Phase 8.

## Security audit (2026-08-11)

Found during a manual security audit against TZ §14's invariants, requested by the user. The
`security-review` skill's `git diff origin/HEAD...` pre-hook errored out before loading (no `origin`
remote configured in this repo — `git remote -v` is empty), so this was done by hand instead: read
through `manifest.service.ts`'s validation rules, `DownloadEngine`/`FileSystemPort`, the SQL layer, the
hexagonal boundary, and dependency surface, cross-referencing each against TZ §14's four hard
invariants and general vulnerability classes for this kind of library (download/checksum pipeline,
SQLite, gated ports). Three concrete gaps found; scoped as `ROADMAP.md`'s new "Security hardening"
section (SEC.1-SEC.3), none implemented yet as of this entry. (Two more low-severity findings from the
same pass — an unvalidated `embedding.dimensions` reaching a SQL DDL string, and `HuggingFaceSource`'s
`repo`/`file` fields going unchecked — were flagged to the user but not yet scoped into ROADMAP.md;
revisit if/when requested.)

### Path traversal via `manifest.filename` (SEC.1)

**Finding:** `validateManifest()` checks `sha256`/`sizeBytes`/`revision`/etc. but never touches
`model.filename`/`embedding.filename`. `DownloadEngine.downloadArtifact()` and `LocalAiClient`'s
old-file cleanup on a model/embedding switch both pass that field straight into
`FileSystemPort.resolvePath('models'|'embeddings', filename)`. Both `resolvePath()` implementations
(`node-fs.adapter.ts`'s `path.join`, `capacitor-fs.adapter.ts`'s `'/'.join`) are explicitly documented
as trusting the caller instead of sandboxing against `../` — an assumption that's false here, since
`filename` originates from the network (the manifest), not from the library's own code.

**Decision:** add a strict filename-shape check to `validateManifest()` — reject any `filename` that
isn't a bare, `.gguf`-suffixed basename (no path separators, no `..`) — as a new
`ManifestValidationError` reason, the same mechanism the `revision`/`sha256` checks already use.
Chosen over hardening `resolvePath()` itself: defense-in-depth there is still worth doing later, but
the manifest-side fix closes the actual gap at its root (an untrusted field being trusted), rather than
only working around a documented, otherwise-reasonable adapter assumption.

**Why:** the manifest is fetched over the network; treating any of its fields as safe to hand to the
filesystem layer unchecked contradicts `resolvePath()`'s own stated trust model ("paths come from
`local-ai`'s own code, never directly from untrusted input").

**How to apply:** implement in `manifest.service.ts`'s `validateManifest()`, mirroring the existing
`HEX64`-regex pattern already used for `sha256`.

### `manifestUrl` not required to be `https://` (SEC.2)

**Finding:** TZ §14 requires HTTPS for every network call the library makes. The resolved model URL
(hardcoded to `huggingface.co`, `artifact-url.ts`) and `embedding.source.url` (checked inside
`validateManifest()`) both enforce this, but `LocalAiConfig.manifestUrl` — the fetch that supplies
`sha256`/`revision` in the first place — is never checked, in either `LocalAiClient.create()` or
`ManifestService`.

**Decision:** `LocalAiClient.create()` throws `ConfigInvalidError` for a `manifestUrl` that doesn't
start with `https://`, checked once at construction (same place `requirePorts()` already validates
`config.ports`), rather than inside `ManifestService.refresh()` on every call.

**Why:** an MITM'd or mistyped `http://` manifest fetch can rewrite the entire manifest — including the
`sha256`/`revision` values the rest of the security model is pinned to — defeating the checksum gate
even though the artifact download itself stays HTTPS-only. The manifest fetch is the actual root of
trust; leaving it unchecked while enforcing HTTPS everywhere downstream of it defeats the point.

**How to apply:** one guard clause in `LocalAiClient.create()`, before `ManifestService` is
constructed. Existing tests already use `https://example.com/manifest.json` as their fixture URL, so
no test-fixture changes are expected.

### DoS via storage exhaustion — `InsufficientStorageError` never thrown (SEC.3)

**Finding:** `EligibilityService` checks `device.freeDiskBytes < artifact.sizeBytes * 1.15` (TZ §6.2)
before a model/embedding switch, but that check is gated by the caller-configurable
`eligibilityPolicy.no` (`'block'` default, overridable to `'warn'`/`'ignore'`) and is only a
point-in-time snapshot. `DownloadEngine.downloadArtifact()` itself never independently checks free
space before writing — `InsufficientStorageError` exists in `errors.ts` (already scoped to TZ §6.2 in
its own doc comment) but is never constructed or thrown anywhere in the codebase.

**Decision:** add `FileSystemPort.freeSpaceBytes(path): Promise<number>` (implemented symmetrically on
`CapacitorFsAdapter` and `NodeFsAdapter`, per CLAUDE.md's port-symmetry rule — this extends an existing
port rather than adding a new one, but the same "every port method needs both adapters" expectation
applies). `DownloadEngine.downloadArtifact()` checks it against `artifact.sizeBytes * 1.15` immediately
before each download attempt, throwing `InsufficientStorageError` (no write attempted) if insufficient
— independent of whatever `eligibilityPolicy` the caller configured.

**Why:** `eligibilityPolicy.no: 'warn'|'ignore'` is an explicit, documented escape hatch for the RAM/
thermal side of eligibility — a product judgment call (TZ §6.4, "is this device *comfortable* running
this model"). It was never meant to also waive the purely-technical "will this write actually fit on
disk" question. Filling a user's device storage to zero is a real availability threat to the OS and
other apps, not just to this library, and shouldn't be reachable just by a consumer choosing a lenient
eligibility policy.

**How to apply:** new `FileSystemPort` method + two adapter implementations + a contract-test scenario
under `test/contract/`, following the `new-port` skill's symmetry checklist even though this extends an
existing port.

## Local logging & export (2026-08-11, requested)

Not a TZ §16 row — TZ §14 only specifies a pass-through `logger?: LocalAiLogger` config (no-op by
default, "no `console.log` in the library's production code"). That interface exists
(`local-ai-client.ts`) but was never actually wired to anything — a `grep 'logger\.'` over `src/`
turns up zero call sites. The user asked for something TZ doesn't cover at all: a **local persisted**
log store the host app can read back later (e.g. an in-app "export logs" button), independent of
whatever `logger` callback the consumer did or didn't supply. Two design questions were asked via
`AskUserQuestion` rather than guessed (CLAUDE.md "ask before guessing"); the rest below are
smallest-reasonable-assumption defaults, logged per CLAUDE.md's instruction to record rather than
silently pick.

**Decision (asked):** storage backend is a new SQLite table (`logs`), not a rotating file. Reuses
`SqlitePort`/`Database`'s existing migration + contract-test infrastructure (already proven for chats,
vectors, FTS5) instead of inventing file-rotation logic — `FileSystemPort.writeFile()` overwrites
rather than appends, so a file-backed ring buffer would need its own in-memory-buffer-plus-flush
machinery for no real benefit over an `INSERT`.

**Decision (asked):** persisted logging is **opt-in**, off by default — new `LocalAiConfig.logging?:
{ enabled?: boolean; minLevel?: 'debug'|'info'|'warn'|'error'; maxEntries?: number }`, default
`enabled: false`. This deliberately does *not* try to match "logger defaults to no-op" from TZ §14
(that line is about the pluggable *callback*, not about whether the library keeps its own local copy)
— opt-in was the user's explicit choice over logging-by-default.

**Decision (smallest reasonable assumption, not asked):** when `logging.enabled`, defaults are
`minLevel: 'info'` and `maxEntries: 5000`, enforced as a hard cap — each append prunes the oldest rows
past the limit in the same transaction (bounded storage, no unbounded growth; same shape as Phase 8's
`SessionCache` LRU cap, `docs/decisions.md` #8). Revisit the numbers if real usage suggests otherwise;
nothing in the TZ or corrections.txt calibrates them.

**Decision (smallest reasonable assumption, not asked):** `exportLogs(options?: { since?: Date;
level?: LogLevel; limit?: number })` returns a plain `LogEntry[]` — no direct file write, no share-sheet
call from inside the library. Same reasoning as `docs/decisions.md`'s "Export/backup" entry above:
the library returns data, the host app decides how to turn it into a file and hand it to a native
share/save flow (`@capacitor/filesystem` + a share plugin) behind its own UI button. Keeps the
hexagonal boundary intact — core has no opinion on native share UX — and matches how `exportChat()`/
`exportChats()` already do it.

**How to apply:** see ROADMAP.md's "Local logging & export" section (LOG.1–LOG.6, all done 2026-08-11)
for the concrete task breakdown — migration, `LogStore` service, wiring real internal call sites (the
dead `logger` callback gets wired at the same time, not just the new store), config, `LogExportApi`,
docs, tests. One implementation-time addition worth a note here: LOG.3 uncovered and fixed a real
concurrency bug — `emit()`'s persisted-log write can't be fire-and-forget without risking "cannot start
a transaction within a transaction" against `NodeSqliteAdapter`'s single shared connection whenever two
loggable events fire close together (or one fires right before another `SqlitePort` call elsewhere in
`LocalAiClient`). Fixed by making `emit()`/the internal log-dispatch helper `async` and awaiting every
call site, with two narrow logger-callback-only exceptions (`download:progress`, and the handful of
throw sites on methods — `complete()`, `sendMessage()`'s pre-check — that must themselves stay
synchronous-returning). See `local-ai-client.ts`'s `emit()` doc comment for the full reasoning; this is
a project convention worth remembering for any future feature that wants to write to `SqlitePort` from
inside `emit()` or another cross-cutting hook.

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

### `CapacitorSqliteAdapter` concurrent-connection/transaction hardening

**Date:** 2026-08-18. A consumer app reported `@capacitor-community/sqlite` throwing "Connection
... already exists" from `createConnection()` and "Already in transaction" from `beginTransaction()`
when the "download model" flow ran. Root cause: `CapacitorSqliteAdapter.getConnection()`
(`src/adapters/capacitor/capacitor-sqlite.adapter.ts`) cached only the *settled* connection, not the
in-flight open — two callers racing into it before the first `await` returned (e.g. a consumer not
memoizing `LocalAiClient.create()`, so a double button-press or a re-render invoked it twice
concurrently, each running `Database.migrate()`) both saw `this.connection === null` and both called
`createConnection()` natively. `transaction()` had no serialization either, so two overlapping
`Database.migrate()`/`LogStore.append()` calls on the same native connection both called
`beginTransaction()`. This is the same class of bug LOG.3 above already fixed *inside* one
`LocalAiClient` (serializing `emit()`); this one is about calls arriving from *outside* — the port
had no defense of its own against a caller that doesn't single-flight client creation.

**Fix (defensive hardening, not a product decision — no TZ/ROADMAP item):**
`CapacitorSqliteAdapter` now (a) caches the connection-open *promise*, so concurrent callers on the
same adapter instance await one `createConnection()` instead of racing; (b) before creating a
connection, checks `isConnection()`/`isDBOpen()` and reuses the existing native connection via
`retrieveConnection()` when one is already registered under the same `databaseName` — covers the
case of two separate adapter/client instances opening the same database name; (c) serializes
`transaction()` calls through an internal promise chain so overlapping transactions queue instead of
colliding on `beginTransaction()`. Not covered by `pnpm test` — this adapter requires the real
Capacitor bridge (CLAUDE.md's testing rule), so it has no automated regression test; verified via
`pnpm lint`/`pnpm typecheck`/`pnpm test:unit`/`pnpm test:integration` only. Consumers should still
memoize `LocalAiClient.create()` (see `examples/minimal-capacitor-app/src/local-ai-setup.ts`'s
`getClient()`) — this hardening makes accidental double-invocation non-fatal, it doesn't make
concurrent client creation a supported pattern.

## External consumer feedback review (2026-08-11)

**Source:** `C:\inetpub2025\forta.chat\docs\plans\llama2\2026-08-11-local-ai-library-feedback.md` —
written by the Forta Chat team while planning their integration against this library at commit
`32b45bd`. Not a code review; a "would I build on this" read of the TZ, ROADMAP, decisions ledger,
guides and source. Ten "what could improve" items (`#1`-`#10`); logged here per CLAUDE.md's "don't
guess silently" rule instead of actioning ad hoc. Disposition of each:

| # | Item | Disposition |
|---|---|---|
| 1 | Device-verification caveat is in README's footer, easy to miss on a skim | **Done** — moved a one-line version to the top of README, right under the status paragraph |
| 2 | `LocalAiClient` (1068 lines) mixes flat methods (`searchMessages`/`exportChat`/`exportLogs`/`clearLogs`) with the namespaced pattern (`client.vectors.*`/`client.downloads.*`) it already uses elsewhere | Logged as `ROADMAP.md` FB.1 — real refactor, not done in this pass (touches the public API surface + every call site, wants its own session) |
| 3 | TZ §10 (public API) never updated for `searchMessages`/`exportChat(s)`/`updateMessage`/`deleteMessages`/`exportLogs`/`clearLogs` — CLAUDE.md calls the TZ "source of truth" | **Done** — §10 synced, version bumped to v5 (see TZ header) |
| 4 | Product-open-questions (9 of 19 `Open` rows above) and engineering-open-tasks are interleaved in one list; no separate "must-decide-before-npm-publish" checklist | **Done** — added `docs/pre-release-checklist.md`, splits this ledger's `Open` rows by who needs to answer them |
| 5 | `ConversationSyncApi` (Mode B) — the Forta Chat integration's entire architecture depends on it, but row #16 above is still `Open` ("ship in v1 at all?") | Not actionable by an agent — genuinely needs the product owner's word. Left `Open`, cross-referenced from the new pre-release checklist so it isn't missed |
| 6 | No "just delete the model, no replacement" method | Logged as new ledger row **#20** above + `ROADMAP.md` FB.5 |
| 7 | MPL-2.0 (`@capgo/capacitor-downloader`) noted but not explained in practical terms | **Done** — added a short "License note" paragraph to README |
| 8 | Eligibility thresholds are a generic formula (§6.2), not per-model calibrated data | **Done** (partial) — added a "Calibrated thresholds" table stub to `docs/guides/support-and-eligibility.md`, empty pending real-device runs; real calibration itself needs a device, tracked as `ROADMAP.md` FB.7 |
| 9 | Exact test counts ("222 tests as of…") hardcoded in README prose, drifts every phase | **Done** — reworded to avoid a number that needs manual upkeep (`pnpm test`'s CI output is the source of truth) |
| 10 | `LogEntry.meta`/`exportLogs()` guide doesn't warn against persisting/exporting raw device or error data | **Done** — added a "What not to put in `meta`" section to `docs/guides/logging-and-export.md` |

See `ROADMAP.md`'s "External feedback backlog — 2026-08-11" section for the task breakdown of what's
still open (FB.1, FB.4/#5, FB.5/#20, FB.7's real calibration).

### First real-device run (2026-08-19) — two bugs the native bridge alone could surface

**Context:** Forta Chat set up a working real-device loop (`docs/plans/llama2/device-ai-loop.md`) —
a physical Android phone connected via `adb`, `local-ai` symlinked in via its `file:` dependency so a
local `npm run build` here is picked up by the consumer's next `npm run cap:run` with no relink step.
First real exercise of the AI tab (open chat list → new AI chat → model gate) since Phase 0.5/0.6/7.4
were written up as "needs a device" and left undone. Two bugs found, both invisible to `pnpm test`
for the same underlying reason: they only exist where a real SQLite build (`@capacitor-community/sqlite`
on the device) diverges from Node's `node:sqlite` (no `fts5` module at all, and no
"every call auto-wraps itself in a transaction" behavior).

1. **`CapacitorSqliteAdapter.execute()` didn't suppress the native plugin's own implicit
   transaction.** `transaction()` opens one via `conn.beginTransaction()`, but
   `@capacitor-community/sqlite`'s `execute()`/`run()` default their own `transaction` param to
   `true` when omitted — called unmodified from inside an already-open `transaction()` (exactly what
   the migration runner does), the plugin tries to nest a second `beginTransaction()` on the same
   connection and throws "Already in transaction". Reproduced on-device as
   `[ai-chat-store] ensureHistorySynced (select) failed: Error: Execute: Failed in
   beginTransactionAlready in transaction` the very first time a consumer opened an AI chat.
   **Fix:** `execute()` now tracks whether it's running inside `transaction()` (`inTransaction` flag,
   set/reset around `fn(this)`) and passes `transaction: false` to `conn.execute()`/`conn.run()`
   whenever it is. Pinned by a new `test/unit/adapters/capacitor-sqlite.adapter.test.ts` that mocks
   `@capacitor-community/sqlite`'s connection surface (the bug is entirely about *which arguments we
   pass*, not native behavior, so a mock is enough — no device needed to pin this one).
2. **`selfTestFts5()`'s own literal broke FTS5's query parser.** `src/core/db/create-message-search-index.ts`
   ran `... MATCH ?` with the bound value `'self-test'` — FTS5 parses the *content* of a MATCH
   argument as its own query language even when parameter-bound, and an unquoted hyphen there isn't
   literal text, so it failed with `no such column: test` and permanently reported FTS5 unavailable,
   falling back to `LikeMessageSearchIndex` on every device that actually has FTS5 compiled in. The
   real search path (`fts5-message-search-index.ts`) already wraps every query through
   `toFtsPhraseQuery()` for exactly this reason — only the self-test's own hardcoded literal was
   unquoted. **Fix:** quote the self-test literal the same way (`'"self-test"'`). Not addable as a
   Node unit test — `node:sqlite` has no `fts5` module at all (see `create-vector-store.ts`'s
   equivalent Node caveat above), so `selfTestFts5()` always short-circuits at `CREATE VIRTUAL TABLE`
   there regardless of the MATCH query below it; verified by re-running the on-device repro instead
   (`chat-search:fallback-active` no longer fires on that device after the fix).

Neither bug needed a *slow* or *low-end* device to find — a mid-range phone with USB debugging was
enough, because both are about the real SQLite build's exact behavior, not about performance/thermal
degradation. Reinforces `2026-08-11-local-ai-library-feedback.md` point #1: the native bridge is
undertested not because it's hard to reach, but because nobody had plugged a phone in and opened the
feature yet.

### `CapgoDownloaderAdapter` — real plugin shapes didn't match this file's assumptions (2026-08-19)

Same device/session, next step down the flow: with a real, CORS-correct manifest wired in
(forta.chat provisioned one), the actual model download (Qwen3-4B-GGUF Q4_K_M, ~2.3GB) was exercised
on-device for the first time ever. Two shape mismatches found by reading
`@capgo/capacitor-downloader`'s real Android source (`CapacitorDownloaderPlugin.java`) after the
symptom appeared — ADR 0003 was `proposed` on source-reading alone at the time it was written, and
apparently the read wasn't thorough enough, or the plugin's behavior drifted since:

1. **`downloadProgress`'s `progress` field is a `0..1` fraction** (`bytesDownloaded / bytesTotal` in
   the Java source), not `0-100` percent as `capgo-downloader.adapter.ts` assumed and passed straight
   through as `progressPercent`. Symptom: the download UI showed a frozen "Скачивание... 0%" for the
   *entire* multi-minute transfer of a real 2.3GB file — `Math.round(0.14)` is still `0`. Would have
   looked identical to a genuinely stuck/hung download from the outside; only reading the native
   source (not just the plugin's own docs/types, which don't mention this) revealed the file was
   downloading fine the whole time.
2. **`checkStatus()`'s real return shape is `{status: <DownloadManager.STATUS_* int>, bytesDownloaded,
   bytesTotal, reason?, reasonText?}`**, not the `{id, progress, state: 'PENDING'|'RUNNING'|...}` this
   file declared and read from (`task.progress`, `task.state` — both simply `undefined` against the
   real response, silently producing `NaN`/`undefined` rather than throwing). Not yet triggered this
   session — `ensureModelReady()`'s main path is driven by `onProgress`/`onCompleted`/`onFailed`
   events, not by polling `status()` — but confirmed broken by the same source read, and `status()` is
   the intended fallback/recovery path (checking an in-flight download's state after an app restart),
   so a real user hitting *that* path would have gotten silently-wrong data instead of a working
   status check.

**Fix:** `capgo-downloader.adapter.ts` — `onProgress` now multiplies by 100; `status()` decodes the
real int status (`PENDING=1`, `RUNNING=2`, `PAUSED=4`, `SUCCESSFUL=8`→`'done'`, everything else
(including `FAILED=16`) →`'error'` with `reasonText` as the message) and computes percent from
`bytesDownloaded`/`bytesTotal` itself. Regression: `test/unit/adapters/capgo-downloader.adapter.test.ts`,
mocking the plugin with the *real* shapes found in the Java source — the bug was a unit-conversion/
shape mistake, not native behavior, so it's fully pinnable without a device.

**Follow-up:** done — `docs/adr/0003-capgo-capacitor-downloader.md` bumped to `accepted` (Android)
with these corrections folded in, plus the resume finding below.

### No real resume on Android — `supportsResume` capability flag (2026-08-19)

Same session, next thing found: restarting the app mid-download (deliberately, to test the
"process-kill survival" question ADR 0003 flagged as unverified) made the download restart from 0%
bytes, not resume from where it left off. Root cause, confirmed by reading
`CapacitorDownloaderPlugin.java`: `pause()`/`resume()` **unconditionally reject** — `"Pausing/
Resuming individual downloads is not supported on Android"`. There is no partial-resume path on this
platform at all; `download-engine.ts`'s own doc comment claiming `transport.start()` again is
"resume-if-partial-exists" was an unverified assumption that turned out to be false for this adapter
(it's true for `NodeRangeDownloadAdapter`, which does real `Range:` requests — the two adapters
genuinely differ here, which is exactly why this needed to be a per-adapter capability, not a global
assumption).

Consequence beyond just "no resume": retrying calls `download()` again, which issues a fresh
`DownloadManager.enqueue()` against a destination file that already partially exists — Android
auto-renames to `-1`/`-2`/... rather than overwriting, so every interruption silently leaked a
full-size orphan file (found one from an earlier test run: `model__qwen3-4b__v1-1.gguf`, sitting next
to the real one, both allocated to the full 2.3GB target size on disk before either had actually
finished writing — that pre-allocation is itself worth remembering, it looks like "already downloaded"
in a plain `ls`/`stat` and cost real debugging time here before checking actual transferred bytes via
`DownloadManager`'s progress column instead).

**Fix:** `DownloadTransportPort` gained `readonly supportsResume: boolean`
(`CapgoDownloaderAdapter`: `false`; `NodeRangeDownloadAdapter`: `true`, it already resumed correctly
so this was purely making an existing distinction explicit, not fixing that adapter itself).
`DownloadEngine.runOneAttempt()` deletes the previous attempt's partial file before retrying only
when `!transport.supportsResume` — a transport that can genuinely resume must keep the file in place,
or its own Range-request logic breaks (this exact regression was caught by a test before it shipped:
an earlier version of this fix deleted the file unconditionally for every retry, which the existing
"resume after a ~50% connection drop" test didn't catch because it only asserts the *final* result is
correct, not that a partial-resume request actually happened — added a `deleteFileSpy` assertion in
both directions, `test/integration/download/download-engine.test.ts`'s new `describe('supportsResume')`
block, specifically to close that gap).

**Update, same session:** the user asked for real resume after all, not just the cleanup above. Built
`CapacitorRangeDownloadAdapter` (`src/adapters/capacitor/capacitor-range-download.adapter.ts`) —
`supportsResume: true`, chunked `Range:` requests through `@capacitor/core`'s `CapacitorHttp` (native
`URLConnection`/`URLSession`, not the WebView's `fetch` — sidesteps the same CORS enforcement the
manifest fetch hit, see `docs/plans/llama2/device-ai-loop.md`), writing incrementally via a new
`FileSystemPort.appendFile()` port method (implemented for both `NodeFsAdapter` and
`CapacitorFsAdapter`) rather than holding the whole multi-gigabyte artifact in memory.
`CapacitorHttp` has no streaming-response API (unlike Node's `fetch`, which
`NodeRangeDownloadAdapter` streams from directly), so this chunks deliberately in fixed 8MB
requests — a genuine engineering tradeoff (bridge round-trip count vs. peak-memory risk on the
low-end devices this project targets), not device-calibrated yet. Fails closed (throws rather than
guessing) if a server ever ignores the `Range` header, instead of risking a multi-gigabyte response
decoded from base64 in one shot. forta.chat's `create-client.ts` now wires this in as
`downloadTransport` instead of `CapgoDownloaderAdapter` — the latter's file/export stays in the
library (still an accurate, documented account of the native plugin's real Android behavior, useful
reference for anyone hitting the same "why doesn't `pause()` work" question), just no longer used for
this port by this particular consumer. Unlocks the UI request that started this: an interrupted
download's retry can now genuinely be a resume, not a restart — `docs/plans/llama2` UI work (the
"докачать модель (скачано 19%)" button copy) is unblocked, not done here (this session stayed in
`local-ai`).

Tests: `test/unit/adapters/capacitor-range-download.adapter.test.ts` (6 tests — chunking, progress,
resume-from-partial-file, fail-closed on non-206, pause) mock `@capacitor/core`'s `CapacitorHttp`
with an in-memory Range-aware fake rather than a real HTTP server, since the adapter's own new logic
(chunk math, resume-offset, Content-Range parsing, cancel handling) is what needed pinning — the real
native HTTP transport is `@capacitor/core`'s to verify, not reachable from Node either way.

## Pause/resume/delete client API (2026-08-19)

Two more forta.chat-side reports drove this: (1) `markDownloadStarting()` seeded the progress bar at
a hardcoded 0% even on a resumed download — the transport itself resumed correctly from the right
byte offset, but the UI briefly *looked* like a full restart every time, until the first real
`onProgress` tick caught back up. (2) The user asked for explicit Pause/Resume and Delete-model
controls in Settings — `CapacitorRangeDownloadAdapter`'s `pause()`/`resume()`/`stop()` were already
real (built same-session, see above) but nothing above the transport layer exposed them.

`DownloadEngine` gained `keyFor()` (the same deterministic key `downloadArtifact()` computes
internally, so a caller can address an in-flight/interrupted download without the engine exposing any
other internal state) plus thin `pause()`/`resume()`/`cancel()` wrappers over the transport — `cancel()`
also clears the persisted `download_state` row and, when `discardPartial`, deletes the file directly
(not left to `transport.stop()` alone, since the transport may have no in-memory task record at all
after an app restart). `LocalAiClient` gained `pauseModelDownload()`/`resumeModelDownload()`/
`deleteModel()`, all resolving the current manifest's model artifact to a key via `keyFor()`.
`ModelRegistry` gained `clearCurrent()` (demotes the "current" row without deleting it — same
demotion `setCurrent()` already does internally, just without a new row to promote). `deleteModel()`
composes all three: `downloadEngine.cancel(..., { discardPartial: true })`, `llmRuntime.releaseModel()`
if it was loaded, `modelRegistry.clearCurrent('model')`.

One real subtlety worth recording: `pause()` deliberately fires neither `onCompleted` nor `onFailed`
on the transport (see `CapacitorRangeDownloadAdapter.pause()`'s own comment) — so a caller `await`ing
`downloadArtifact()`/`ensureModelReady()` while paused just stays pending, not settled, until
`resume()` lets the same in-flight promise chain complete normally. This is exactly what forta.chat's
UI wants (the download "operation" spans the pause), but it means `pauseModelDownload()`/
`resumeModelDownload()` carry NO progress-event signal of their own — forta.chat's store tracks
"is paused" as UI-only state, cleared by any real `download:progress` tick or a terminal
`download:completed`/`download:failed`, not by anything `local-ai` emits directly.

Also fixed in this pass: `download-engine.ts`'s `computeKey()` had a literal NUL byte in place of the
space between `${url}` and `${filename}` in its template literal — real file corruption (cause
unknown, possibly a bad write in an earlier session), invisible in a normal editor/Read but enough to
make `grep`/the Edit tool's exact-string matching treat the file as binary. Fixed by patching the byte
directly; functionally the NUL was silently absorbed into the hashed string on every call so it never
produced a visible bug, just corrupted the file at rest.

Tests: `test/integration/download/download-engine.test.ts`'s new `pause/resume/cancel` block and
`test/integration/client/local-ai-client.test.ts`'s new `pauseModelDownload()/resumeModelDownload()/
deleteModel()` block both use a dedicated ~60MB payload (not the suites' usual few-byte/2MB fixtures)
specifically so there's a real window to catch a transfer mid-flight before it completes — a first
draft using the small shared fixture passed all assertions vacuously (the "pause" landed after the
tiny download had already finished).

### Session persistence was permanently broken on Android — two bugs found verifying the `llama-cpp-pro` migration (2026-08-20)

**Context:** Real-device pass of `docs/adr/0008-llama-cpp-pro-migration.md`'s §7 checklist (see that
ADR for the migration itself). The very first message sent through an existing AI chat produced
`E/LlamaCpp: saveSession failed: Failed to save session to:
/data/user/0/com.forta.chat/files/sessions/session-<chatId>-qwen3-4b%3A1.bin` right after a
successful, complete generation (238 tokens, correct EOS stop — the migration itself was fine). Two
independent bugs, both in `local-ai`, both predating this migration (would have affected
`llama-cpp-capacitor@0.1.5` identically — this explains the "did `saveSession`/`loadSession` ever
actually work on Android?" open question ADR 0008 flagged, just not for the reason it guessed):

1. **`sessions/` directory never created.** `SessionCache.save()` hands `llmRuntime.saveSession()` a
   raw absolute path computed via `fileSystem.toAbsolutePath()` — that call goes straight to the
   native runtime binding, bypassing this port's own `writeFile()`/`appendFile()` (which auto-create
   parent directories via their own `mkdir()` call). Nothing else in `SessionCache`'s lifecycle ever
   created `sessions/`, so the very first save on any chat, on a fresh install, always failed.
   Confirmed via `adb shell run-as com.forta.chat ls files/sessions/` → `No such file or directory`
   after a completed generation on-device. **Fix:** `SessionCache.save()` now calls
   `fileSystem.mkdir(fileSystem.resolvePath('sessions'), { recursive: true })` before
   `llmRuntime.saveSession()`. `FakeLlmRuntimeAdapter.saveSession()` (`node-testing`) used to paper
   over this by auto-`mkdir`-ing itself — removed, so the fake now matches the real native plugin's
   behavior and the existing `session-cache.test.ts` suite actually exercises this path.
2. **`CapacitorFsAdapter.toAbsolutePath()` didn't decode the URI it got back.** `Filesystem.getUri()`
   correctly returns a percent-encoded `file://` URI; the model fingerprint's own `:` separator (e.g.
   `qwen3-4b:1`) came back as `%3A`. The stripped-prefix result was handed to the native plugin as a
   literal path — meaning `saveSession()`/`loadSession()` would target a *different* filename
   (`...4b%3A1.bin`) than `exists()`/`stat()` (which resolve through the plugin's own
   already-decoded path handling, `...4b:1.bin`) could ever find again, permanently — a working
   `saveSession()` still wouldn't have made session caching work. **Fix:** `decodeURIComponent()` the
   stripped URI before returning. Pinned by a new
   `test/unit/adapters/capacitor-fs.adapter.test.ts` case with a `%3A` fixture.

**Both bugs are fixed in `local-ai` as of this entry** — not yet re-verified end-to-end on-device
(session save/load timing comparison, ADR 0008 §7 item 1) at the time of writing; that's the next
step in the same device-ai-loop session. Neither needed a slow/low-end device to exist — a mid-range
phone was enough, same lesson as the two SQLite bugs above: this class of bug is invisible to
`pnpm test` not because it's inherently hard to catch, but because the Node-fake adapters
(`NodeFsAdapter`, `FakeLlmRuntimeAdapter`) were both slightly *more* forgiving than the real native
plugin/Capacitor Filesystem behavior they stand in for.

### No per-token streaming on Android, confirmed — closes ADR 0001/0008's residual risk (2026-08-20)

**Context:** `forta.chat` reported AI replies rendering all at once instead of typing in, on a real
Android device. Before this entry, that was an open, documented risk — ADR 0001 (2026-08-10) flagged
"whether the callback in `completion()` fires reliably per-token on both Android and iOS builds" as
"not verifiable here, needs Phase 4's manual device smoke test," and ADR 0008 (this migration) still
listed "Full `device-ai-loop.md` smoke pass (…→ stream →…)" as an open item. This is that smoke test.

**What was checked:** a temporary counter/timestamp log in `LlamaCppCapacitorAdapter`'s `onToken`
callback (`llama-cpp-capacitor.adapter.ts`), a real device, and a fresh chat with a short prompt to
avoid a multi-minute prefill on the prior long-context chat confounding the result (that chat's
988-token prompt genuinely took the CPU 460%+/several minutes just to load — a real, separate
CPU-inference-speed concern, not this one). Result: **`onToken` never fired, not even once**, across a
clean ~17s generation (`скажи одно слово` → `Свет.`, 3 tokens, confirmed via `adb logcat`).

**Root cause, confirmed by reading the installed package, not guessed:**
- Native generation genuinely IS per-token — `adb logcat`'s `LlamaCpp`/`RNLlama` tags show `Generating
  token 1...` / `Generated token 1 (ID: 19311): С` / `Generating token 2...` etc., one at a time, in
  real wall-clock time (~1 token/second on this device).
- The JS wrapper (`llama-cpp-pro@0.2.4`, `dist/esm/index.js`) does its side correctly: `completion()`
  sets `emit_partial_completion: !!callback` and registers `LlamaCpp.addListener(EVENT_ON_TOKEN, ...)`
  before calling native `completion()` — this is genuinely wired to invoke the caller's callback per
  token, exactly as documented.
- But `node_modules/llama-cpp-pro/android/src/main/java/ai/annadata/plugin/capacitor/*.java` —
  `LlamaCppPlugin.java`, `LlamaCpp.java` — contain **zero** occurrences of `notifyListeners`, `onToken`,
  or `EVENT_ON_TOKEN` anywhere (`grep -rl` across the whole `android/src` tree came back empty).
  `completion()` on the Java side is one blocking call into `completionNative()` (JNI) that returns the
  full `NativeCompletionResult` once, at the end. Whatever "Generating token N..." logging is doing
  internally, on this platform there is currently no code path that could ever surface it as a
  Capacitor event — `emit_partial_completion: true` has nothing to be received by. Latest published
  version is `0.2.4` (confirmed via `npm view llama-cpp-pro versions` — nothing newer to upgrade to).

**This is an upstream `llama-cpp-pro` Android gap, not a `local-ai` bug** — every layer downstream of
`onToken` (`AsyncTokenQueue`, `LocalAiClient.sendMessage()`'s own forwarding loop, `forta.chat`'s
`ai-chat-store.ts` `for await` loop into `streamingContent`) is correct and does stream token-by-token
whenever tokens actually arrive; this was re-confirmed by re-reading all four layers against this
finding, not assumed. Nothing to fix in `local-ai`'s adapter — a synthetic single-chunk emission once
`completion()` resolves was considered (ADR 0001's own stated fallback for exactly this case) and
skipped: the caller already receives the full content via `stream.result` either way (`forta.chat`'s
`ai-chat-store.ts` persists the final message from local-ai's own Dexie write, not from the stream), so
a synthetic chunk would only relabel the existing "appears all at once" behavior, not change it. Left
documented in `onToken`'s own doc comment in `llama-cpp-capacitor.adapter.ts` for the next person who
goes looking. A real per-token typing UX on Android needs either an upstream fix/PR against
`llama-cpp-pro`'s Android plugin (add the missing `notifyListeners` wiring in `LlamaCppPlugin.java`) or
a client-side simulated-typing animation over the final text in `forta.chat` — both out of scope for
this entry, product/eng call to make separately.

**Not checked:** iOS. ADR 0001's per-token risk was always "both Android and iOS" — this entry only
closes the Android half. iOS's native plugin source wasn't inspected here (no iOS device in this
session) and may or may not have the same gap.

### Android per-token streaming fixed — missing `notifyListeners` wiring added upstream (2026-08-20)

**Context:** Direct follow-up to the entry above. Fixes the exact gap that entry found: `jni.cpp`'s
token-generation loop genuinely runs per-token, but nothing on the Java side ever forwarded a token to
the Capacitor bridge.

**Fix, patched into the installed `llama-cpp-pro@0.2.4` package (`forta.chat`'s `node_modules`, applied
via `patch-package`, see below):**
- `jni.cpp`'s completion loop now calls a new `LlamaCpp.emitPartialToken(int contextId, String token)`
  once per generated token (`env->CallVoidMethod`, method ID looked up once outside the loop, gated on
  the existing `emit_partial_completion` param — no per-token JNI lookup overhead added).
- `LlamaCpp.java` gained that method: builds the `{contextId, tokenResult: {token}}` payload the JS
  wrapper's `completion()` already listens for (`dist/esm/index.js`, unchanged — its side was already
  correct per the entry above) and forwards it to `LlamaCppPlugin.emitTokenEvent()`.
- `LlamaCppPlugin.java` gained `emitTokenEvent()` — a thin package-visible wrapper around
  `Plugin.notifyListeners()`, needed because `notifyListeners` is `protected` on Capacitor's base
  `Plugin` class and `LlamaCpp` is a separate, non-subclassing object. Found by real compilation, not
  by reading: `LlamaCpp` now takes the plugin instance via a new `LlamaCpp(Context, LlamaCppPlugin)`
  constructor (old single-arg constructor kept for any other call sites/tests), and
  `LlamaCppPlugin.load()` passes `this`.
- Calls `notifyListeners("@LlamaCpp_onToken", event)` — the exact event name/payload shape the JS side
  was already waiting for, so nothing downstream needed to change.

**Verified on-device (P80, 2026-08-20), not just compiled:** native (CMake/NDK) build and the full
`forta.chat` `assembleDebug` both succeeded; installed via `npm run cap:run` (a prior `adb install -r`
of a standalone APK had actually left a **stale** web bundle on the device — the AI tab silently didn't
render because of it, unrelated to this fix but worth remembering: always redeploy through the project's
normal `cap:run` pipeline, not an ad hoc APK install, when verifying anything that also touches the web
bundle). Sent a real message through an existing AI chat and watched `adb logcat` live:
```
16:42:28.054 I/LlamaCpp: Generated token 1 (ID: 16206): В
16:42:28.055 V/Capacitor/LlamaCppPlugin: Notifying listeners for event @LlamaCpp_onToken
16:42:28.971 I/LlamaCpp: Generated token 2 (ID: 50695): аш
16:42:28.971 V/Capacitor/LlamaCppPlugin: Notifying listeners for event @LlamaCpp_onToken
...
```
`Notifying listeners for event @LlamaCpp_onToken` fires immediately after every single `Generated
token N` line, at the same ~1 tok/s cadence this file's baseline entry measured — confirms real
per-token delivery, not a batched/synthetic emission. Not yet re-verified that `forta.chat`'s UI
actually renders the incremental typing effect end-to-end (downstream layers were already re-confirmed
correct by reading in the entry above; this session watched the native/bridge layer only) — worth a
quick visual pass, not expected to be a real risk given that re-confirmation.

**`patch-package` note:** `forta.chat`'s `patches/llama-cpp-pro+0.2.4.patch` captures this fix (`LlamaCpp.java`,
`LlamaCppPlugin.java`, `jni.cpp`). Generating it required first deleting
`node_modules/llama-cpp-pro/android/{build,.cxx}` (Gradle/CMake's own build-cache output, regenerated by
the next build regardless) — `patch-package` unconditionally `git add -f`s the whole package tree before
diffing, and one of Gradle's deeply-nested transform paths there exceeded Windows git's filename-length
limit, failing the patch generation entirely (`--exclude` doesn't help — it only trims the final diff,
not the initial add). The generated patch also contains a `Binary files ... differ` hunk for the
vendored `jniLibs/arm64-v8a/libllama-cpp-arm64.so` — that hunk carries no actual patch data (git didn't
emit a binary patch for it) so `patch-package`'s apply step is a no-op for that file. Harmless: the
`.so` is rebuilt from the now-patched `jni.cpp`/`CMakeLists.txt` by every real Gradle build (confirmed —
this session's `assembleDebug` ran `buildCMakeDebug[arm64-v8a]`, not `UP-TO-DATE`), so the stale vendored
binary a fresh `npm install` would leave in place never actually ships; flagging only so a future reader
doesn't assume the `.so` hunk is doing something it isn't.

**Still open:** iOS has the same class of gap, but broader — see next entry.

### iOS: `notifyListeners` unimplemented in `llama-cpp-pro`'s Swift plugin entirely, not just for tokens (2026-08-20)

**Finding, confirmed by reading (no iOS device in this session — source-only, same caveat as ADR 0001's
original iOS-side risk):** `grep -rc notifyListeners node_modules/llama-cpp-pro/ios/Sources` returns
zero across all four Swift files (`LlamaCpp.swift`, `LlamaCppPlugin.swift`, `LlamaNativeBridge.swift`,
`ModelAdmissionController.swift`). This is broader than the Android gap the two entries above closed —
Android's problem was specifically the token-streaming path; iOS's `LlamaCppPlugin.swift` never calls
`Plugin.notifyListeners()` for **any** event at all, not just `@LlamaCpp_onToken`. Whatever
`addListener`-based event contract the JS wrapper (`dist/esm/index.js`) expects from the native side,
none of it can currently fire on iOS.

**Not fixed here** — out of scope for this Android-focused session (no iOS device to verify against, and
the fix shape may differ from Android's `emitPartialToken`/`emitTokenEvent` plumbing since Swift's
`Plugin.notifyListeners()` isn't gated behind a `protected` visibility problem the way Capacitor's
Android base class is). Logged so the next person working on iOS parity for this plugin doesn't have to
rediscover it — same "don't guess silently" reasoning as the rest of this ledger. A real fix needs the
same treatment as the Android one: read `llama-cpp-pro`'s Swift completion loop, find where per-token
(and any other streamed) results are computed, and add the missing `notifyListeners()` call(s) at that
point.

### iOS token-streaming patch drafted (source-read only, not built/verified — 2026-08-20)

**Context:** Direct follow-up, same day, no iOS device/Mac available in this environment either — user
asked for a patch to apply and verify later on a Mac, scoped narrowly to `@LlamaCpp_onToken` (parity
with the Android fix above), not the full "no event fires at all" gap the previous entry found.

**Good news found while drafting:** unlike Android, this did **not** need a C++ change. Reading
`cpp/cap-ios-bridge.cpp` turned up `llama_completion_stream(context_id, params_json, token_callback,
user_data)` — a per-token-callback C function that **already exists**, explicitly commented "Streaming
completion with per-token C callback (all native/desktop targets)", sitting unused: iOS's
`LlamaNativeBridge.swift` only ever called the non-streaming `llama_run_completion`. So the drafted fix
is Swift-only:
- `LlamaNativeBridge.swift`: new `runCompletionStream()`, `dlsym`-loading `llama_completion_stream` and
  bridging its C callback to a Swift closure via a `TokenBox` boxed through `Unmanaged`/`void *user_data`
  (`@convention(c)` closures can't capture Swift context directly).
- `LlamaCpp.swift`: new `onPartialToken` closure property (Swift-idiomatic analog of Android's
  `LlamaCpp(Context, LlamaCppPlugin)` back-reference); `completion()` now checks the JS-side
  `emit_partial_completion` param (same gate Android/the JS wrapper already use) and calls
  `runCompletionStream()` instead of `runCompletion()` when set, falling back to the non-streaming path
  on `.missingSymbol` (fails closed, mirrors Android's "method not found → streaming disabled, call
  still succeeds" behavior).
- `LlamaCppPlugin.swift`: first `notifyListeners()` call this plugin has ever had, added in a new
  `override func load()`, wired to `implementation.onPartialToken`.

**Explicitly not verified — every `TODO(mac)` inline in the patch needs a real build to resolve:**
whether `llama_completion_stream` is actually compiled into the currently-vendored/rebuildable
`ios/Frameworks/llama-cpp.xcframework` (the function existing in `cpp/` doesn't guarantee it survived
into that binary); whether `notifyListeners()` needs a main-thread hop (it fires from the background
queue `LlamaCpp.completion()` already dispatches onto — Android's JNI thread tolerated this, iOS
unconfirmed); the exact `notifyListeners(_:data:)` signature on the installed Capacitor iOS SDK (no
existing call site in this plugin to copy, per the previous entry's zero-occurrences finding); and
whether `llama_completion_stream`'s result JSON — which always reports empty `reasoning_content`,
`stopped_word`, `stopping_word` (unlike `llama_run_completion`) — causes any visible regression for
`<think>`-block or `stop`-param-dependent prompts.

**Patch file:** `docs/patches/llama-cpp-pro+0.2.4-ios-token-streaming.patch` (+ that directory's
`README.md` for apply/rebuild/verify steps). Not applied to this repo's own `node_modules` on disk —
kept as a patch to apply (via `patch-package`, same convention as the Android fix) in whichever project
actually builds for iOS.

### ADR 0008 §7 device-verification checklist closed out, baseline `tgAvg` recorded (2026-08-20)

**Context:** Continuation of the same device-ai-loop session as the two entries above — closing out
the five items ADR 0008 listed as still needing a real device, plus recording the baseline
measurement `forta.chat`'s `docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md` §9 needs before
any of its own phases (`n_threads`, `enable_thinking`, `n_batch`/`n_ubatch`, ...) land. Full detail on
each of the five lives in ADR 0008's own "Consequences" section now (not duplicated here) — this entry
covers method and the two numbers that matter downstream.

**Method, for repeatability:** rather than DOM-scraping the chat UI for a "first token appeared" signal
(unreliable — the no-per-token-streaming finding above means there IS no such signal, and
`ChatVirtualScroller`'s virtualized DOM made `visibleTexts()` polling flaky besides), timing was read
from two ground-truth sources instead:
1. **`adb logcat`**, captured continuously to a file for the whole session — `LlamaCpp`'s own
   `Loading prompt into completion context...` → `Beginning completion generation...` →
   `Generated token N...` (one line per token, real wall-clock) → `Reached end-of-generation` gives
   exact prefill-start/generation-start/per-token/generation-end timestamps directly, no client-side
   inference needed.
2. **The app's own SQLite DB**, pulled off-device with
   `adb exec-out run-as com.forta.chat cat databases/local_ai_<id>SQLite.db > local.db` — critically
   **`exec-out`, not `shell`**: `adb shell run-as ... cat > file` on this Windows setup silently
   corrupts binary output (looked like `SQLite: database disk image is malformed` — actually a
   LF→CRLF text-mode translation happening somewhere in the `shell` pipe; file size came back ~170
   bytes larger than the on-device original). `exec-out` doesn't allocate a pty and is binary-safe;
   the pulled file's size matched the device's `ls -la` exactly and `node --experimental-sqlite`
   opened it cleanly. `chat_messages.created_at` gives exact send/complete wall-clock timestamps
   without needing the UI to render anything.

**Two real generations, same chat, same warm context** (Qwen3-4B Q4_K_M, `n_ctx=4096`, native default
`n_threads`/`n_batch=512` — none of the perf-tuning plan's phases applied yet, this is the "before"
baseline):

| Turn | Prompt tokens evaluated | Prefill time | Prefill tok/s | Tokens generated | Generation time | Generation tok/s | Total round-trip |
|---|---|---|---|---|---|---|---|
| 1 | 42 | 22.8 s | 1.84 | 141 | 130.3 s | 1.08 | ~153 s |
| 2 | 226 (full turn-1 history + new msg) | 159.8 s | 1.41 | 433 | 430.2 s | 1.01 | ~590 s |

Generation throughput held flat (~1.0–1.1 tok/s) both turns, as expected. Prefill did **not** get
faster on turn 2 despite most of its 226 tokens being a repeat of turn 1's already-evaluated
prompt+reply (same in-memory `LlamaContext`, no `loadSession` call happened between turns — confirmed
via logcat, `SessionCache.activate()` correctly recognized the context was already warm and skipped
disk I/O entirely) — it got *slower* per-token (1.84 → 1.41 tok/s), consistent with plain
per-token attention cost scaling with context length rather than any prefix being skipped. This is
CPU-only `llama.cpp` behavior, not a `local-ai` bug — flagging it here because it means the *cold vs.
warm* comparison ADR 0008 originally asked for (message 1 vs. message 2 in the same chat) doesn't
actually test what it was meant to test; a real cold-reload comparison (force-stop/relaunch or switch
away and back, then send a message) is still open, tracked in the perf-tuning-plan's own §9.

**tgAvg for the perf-tuning plan's baseline row:** ~1.0–1.1 tok/s generation / ~1.4–1.8 tok/s prefill,
this device, this model, no tuning applied — directly explains the "отвечает очень долго" complaints
independent of the reasoning-phase/`enable_thinking` issue perf-tuning-plan.md's Фаза 2 targets: even a
short reply's prefill+generation alone runs into minutes.

### `n_threads` plumbed and device-measured — no throughput win at cap 4 (2026-08-20)

**Context:** perf-tuning plan's Фаза 1 (`forta.chat`'s `docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md`
§3, `llama2-perf` branch in both repos). `LlmRuntimePort.loadModel()` gained an optional `threads`
field, `LlamaCppCapacitorAdapter` forwards it to `initLlama()` as `n_threads` only when set,
`LocalAiConfig.runtimeTuning.threads` wires it through both `local-ai-client.ts` call sites.
`forta.chat`'s `createLocalAiConfig()` sets it from `navigator.hardwareConcurrency`, capped
`[2, 4]` (`computeRuntimeThreads()`, `entities/local-ai/lib/create-client.ts`). All four repo-side
gates green (lint/typecheck/unit/integration/build) before this device pass.

**Device pass, same device/model as the baseline entry above** (P80, Qwen3-4B Q4_K_M) — new empty AI
chat (not reusing history, to keep prompt length comparable to the baseline's own turn 1), prompt
"Расскажи короткую историю про кота" (40 tokens after the ChatML-fallback template — native jinja
failed again this run, same `minja`-class issue as before, unrelated to this phase), same
`adb logcat` timestamp method:

- `initContext()`'s own logged params confirm the field actually reaches the native call:
  `{"n_ctx":4096,...,"n_threads":4}` — previously this key was absent entirely.
- Prefill: 40 tokens / 21.2 s = **1.89 tok/s**. Generation: 315 tokens (natural EOS stop, not a
  truncation) / 294.9 s = **1.07 tok/s**.

**Finding:** both numbers land inside the baseline's own noise band (1.0–1.1 tok/s generation,
1.4–1.8 tok/s prefill) — no measurable speedup from setting `n_threads` explicitly to 4.
`adb shell cat /sys/devices/system/cpu/possible` → `0-7`, so this device actually has 8 cores;
`forta.chat`'s conservative `min(hardwareConcurrency, 4)` cap (plan §3's deliberately cautious
starting point, chosen to avoid bigLITTLE efficiency-core/thermal risk without a device to test on)
never asks for more than 4. Two explanations are equally consistent with one sample and neither is
confirmed: (a) llama.cpp's own native thread-count default on this device was already ~4, so the
explicit value changed nothing in practice; (b) single-token CPU decode at this model size/quant is
memory-bandwidth-bound rather than thread-count-bound past a fairly low core count, so 4→4 (or even
4→8) wouldn't move tok/s much regardless. Plan §11 open question 1 (the exact threads ceiling) is
**not resolved** by this pass — the plumbing is verified correct end-to-end, but the specific value
chosen isn't shown to help yet. Next measurement before touching the cap: rerun the identical method
with `runtimeTuning.threads: 8` on this same device and compare.

### `sanitize_utf8()` was truncating whole AI replies at one bad byte, not just a trailing cutoff (2026-08-20)

**Found by the user, eyeballing the screen** after the `n_threads` device pass above — the on-device
cat-story reply (315 tokens, natural EOS stop per the logcat entry above) rendered and persisted cut
off mid-sentence at roughly 40% of its length, with a stray glyph visible right at the cut point during
live streaming ("я еще видел как раз в месте обрезки какой-то utf символ"). Confirmed as real data loss,
not a UI rendering artifact, by pulling `forta.chat`'s SQLite `chat_messages` row directly (same
exec-out method as the baseline entry above): `status: 'complete'`, `token_count: 315` (correct, matches
the native `tokens_predicted` counter), but `content` cut off at the exact same point shown on screen.

**Root cause**, `llama-cpp-pro`'s (patched) `jni.cpp`, `jni_utils::sanitize_utf8()` — added by an earlier
session's patch (this same `docs/decisions.md`, "no per-token streaming on Android" era work) to stop
`env->NewStringUTF()` aborting the whole app on invalid Modified UTF-8. That function scanned the fully
generated response for the first invalid UTF-8 byte and **truncated the entire string from there on**
(`return s.substr(0, i)`) — correct for the case it was written for (a hard `n_predict` cutoff landing
mid-character at the very end of generation) but wrong for a single malformed byte anywhere earlier in
an otherwise-complete, EOS-terminated reply. Byte-level BPE tokenizers (Qwen included) can emit a token
whose raw text isn't valid UTF-8 on its own; one such token mid-response was enough to silently discard
everything the model generated after it — while `tokens_generated` (a separate `int` counter, unaffected
by the string truncation) kept counting correctly, which is why `token_count` in the DB looked fine and
masked the bug from anything that only checked that field.

**Fix**: rewrote `sanitize_utf8()` to keep scanning the whole string and only *drop* the specific
offending byte(s), instead of stopping at the first one — the output is still built exclusively from
validated complete UTF-8 sequences (same `NewStringUTF()`-safety guarantee as before), but one bad byte
now costs at most one character instead of the rest of the reply. Patch regenerated via
`npx patch-package llama-cpp-pro` — first had to delete
`node_modules/llama-cpp-pro/android/{build,.cxx}` (leftover Gradle/CMake build output containing paths
too long for git's index on Windows, which made patch-package's own internal `git add` step fail with
`Filename too long` / a confusing downstream `Argument list too long` if not cleaned first).

**Re-verified on the same device, same method** (adb logcat + direct SQLite pull, not just eyeballing
the screen): a fresh 246-token reply to the identical prompt persisted end-to-end with a genuine
narrative conclusion, no mid-sentence cut. Full technical detail and the regenerated patch diff live in
`forta.chat`'s own commit on `llama2-perf` (same date) — this entry is the cross-reference for anyone
reading `local-ai`'s own history first.

### Per-token streamer leaked literal `"byte: \xNN"` debug text for split multi-byte UTF-8 characters (2026-08-21)

**Found by the user, eyeballing an AI reply on-device**: streamed and persisted text contained literal
garbage like `Классика! byte: \x90byte: \xbe...` instead of the intended characters — visible both live
during streaming and in the message afterwards, in an existing chat from before this fix.

**Root cause**: `llama-cpp-pro`'s two real per-token streaming call sites (Android's `jni.cpp` generation
loop, iOS's `cap-ios-bridge.cpp` `token_callback`) formatted each token with
`capllama::tokens_to_output_formatted_string()` — a formatter meant for debug/probs listings
(`cap-completion.cpp`'s legitimate debug dump, left untouched) that renders any byte it can't interpret
as a printable character as literal `"byte: \xNN"` text. Byte-level BPE tokenizers (Qwen included)
routinely emit a token that is only a *fragment* of a UTF-8 character — a lone continuation byte with no
lead byte, or a lead byte with its continuation byte(s) still one token away. Fed one fragment at a time
into the debug formatter, each incomplete byte got rendered as its own `"byte: \xNN"` string instead of
being held back and reassembled with the next token(s) into the real character. This is the same root
class of bug as the `sanitize_utf8()` entry above (byte-level BPE splitting a UTF-8 character across
token boundaries) but on the *encoding* side of the pipeline rather than the JNI *string-conversion*
side — `sanitize_utf8()` guards `NewStringUTF()` against genuinely invalid bytes reaching the JVM, but by
that point the formatter had already turned valid-when-reassembled fragments into permanent, valid-UTF-8
garbage text, so the earlier fix couldn't catch this.

**Fix**: added `format_token_utf8_safe(ctx, token, pending)` (`cpp/cap-llama.h`/`cap-llama.cpp`) — buffers
a token's raw piece bytes into a caller-owned `pending` string, scans for the longest complete-UTF-8-
sequence prefix, returns only that prefix, and leaves any trailing incomplete sequence in `pending` for
the next call to complete. A byte that can never start a valid sequence is dropped (one character lost,
matching `sanitize_utf8()`'s "cost at most one character" precedent) rather than re-emitted as debug
text. Wired in at both real streaming call sites in place of `tokens_to_output_formatted_string()`,
each with its own `pending_utf8` buffer declared before the token loop; `jni.cpp`'s `emit_partial` block
and iOS's `token_callback` are now guarded with `!token_text.empty()` since a fragment-only token
legitimately produces nothing to emit yet. Patch regenerated (`patches/llama-cpp-pro+0.2.4.patch` in
`forta.chat`) via manual reconstruction after `npx patch-package` crashed on Windows CRLF diff noise
(unrelated pre-existing tooling issue, not this bug) — verified byte-identical to the live edits by
re-running the real `patch-package` applier against a scratch pristine copy.

**Verified on the same device**: rebuilt the native library (confirmed real recompilation via compiler
warning output, not "UP-TO-DATE"), no crash signal in logcat. The pre-fix broken chat above stayed
visible in the chat list for direct comparison; a fresh chat with a prompt designed to provoke
multi-byte characters (emoji + Cyrillic) produced a clean reply with correctly-rendered emoji and zero
`"byte: \x"` leakage. Full technical detail and the regenerated patch diff live in `forta.chat`'s own
commit on `llama2-perf` (same date) — this entry is the cross-reference for anyone reading `local-ai`'s
own history first.

### `enable_thinking: false` device-verified through the native jinja path, not the ChatML fallback (2026-08-20)

Perf-tuning plan §4 (`forta.chat`'s `docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md`).
`CompletionOptions.enableThinking?: boolean` added to `core/types.ts`; `LlamaCppCapacitorAdapter`'s
`samplingParams()` forwards it as `enable_thinking` on both `CompletionParams` objects it builds
(`nativeJinjaParams`/`callerFormattedParams` — the ChatML-fallback path has its own, separate
skip-thinking mechanism, an already-closed `<think></think>` prefix, see that path's own doc comment
for why `enable_thinking` can't reach it). `forta.chat`'s `ai-chat-store.ts` now sends
`completionOptions: { enableThinking: false }` on every `sendMessage()`.

**First verification attempt was a false positive from a broken DOM-polling script**, worth recording
so it isn't repeated: a CDP script sent the prompt, then polled `document`'s visible text nodes for
"whatever text sits near the sent message" as a stand-in for the reply. The composer navigates back to
the plain chat list right after send (by design, not a bug), and once there, the "nearest text" heuristic
happily matched an unrelated chat row's preview text several screens away — the script reported PASS in
under 20s, impossible for this device's ~1 tok/s. Deleted rather than fixed; DOM polling is the wrong
tool for reading a reply's content on this app (`device-ai-loop.md` already says as much for timing
measurements — this extends the same lesson to content checks).

**Real verification**: direct `adb logcat` read of the native `LlamaCpp` bridge, same method as the
`n_threads`/baseline entries above. `initContext()`'s log line confirmed the loaded GGUF's
`chatTemplates` includes a working `minja` template (`"chatTemplates":{"minja":{"default":true,...}}`)
— i.e. this run went through mechanism 1 (native jinja), not the ChatML fallback, so `enable_thinking`
was actually exercised, not bypassed. The token-generation log starts directly with the story
(`Generated token 1 (ID: 132042): Ж`, `token 2: ила`, spelling out "Жила-была кошка...") — zero `<think>`
tokens at any point. The final `completion()` result object, also visible in logcat
(`Capacitor/Console` bridging the native JSON back to JS), confirms it structurally:
`"reasoning_content":""`, `"content":"Жила-была кошка по имени Мурка...` (straight into the story),
`"stopped_eos":true`, `"tokens_predicted":166` — a clean, natural completion with no reasoning phase at
all. Two earlier "successful" cat-story replies found in the same SQLite pull (16:05/16:44 UTC) turned
out to predate this session's `cap:run` redeploy (~17:11 UTC) — leftover data from the prior
(`n_threads`-only) build, not evidence for this change; timestamps matter when cross-checking SQLite
against a deploy.

Also worth noting for the next person pulling this device's SQLite over `adb`: `adb shell run-as ... cat
> file` through PowerShell's `>` redirection prepends a UTF-8 BOM (text-mode encoding), corrupting the
`SQLite format 3` header. `adb exec-out` alone isn't sufficient on this shell — route the bytes through
a `spawnSync(..., { encoding: undefined })`-style raw Buffer capture (Node) rather than a shell `>`
redirect, or the pulled file silently isn't a valid SQLite database (`ERR_SQLITE_ERROR: file is not a
database` when opened).

### Visual per-token streaming confirmed in the `forta.chat` chat screen itself, not just the bridge (2026-08-21)

Perf-tuning plan §11 open question #6 (`forta.chat`'s
`docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md`). Everything up to this point had confirmed
the *bridge* (`@LlamaCpp_onToken` → `notifyListeners`, "Android per-token streaming fixed" entry above)
and the *store* (`ai-chat-store.ts`'s `for await` loop) but nobody had watched the actual chat screen to
confirm `AiChatView.vue`'s bubble really repaints per token rather than sitting static until the whole
reply lands at once.

**Method** (`forta.chat`'s new `scripts/device-e2e/verify-visual-token-streaming.mjs`, on `iter1`, real
device P80): sent a prompt over CDP, then polled the DOM every 500ms anchored on the streaming cursor
markup itself (`AiChatView.vue`'s `.animate-pulse.bg-current` span, rendered only while
`message.status === 'streaming'`) rather than a generic "nearest preceding text" heuristic — an earlier
attempt at this same check used that heuristic and got a false-positive match against an unrelated
sidebar chat-list preview a couple of screens away (same failure class `enable_thinking`'s own
verification entry above already warned about with its CDP/DOM-polling caveat). Anchoring on the cursor
element's own parent bubble sidesteps that: no cursor present means no streaming bubble to misread.

**Result**: 26 distinct length samples on the streaming bubble's `textContent`, growing from 2 to 85
characters over `+41.5s` to `+54.8s` after send, word-by-word/token-by-token
("` С`" → "` Соб`" → "` Собак`" → … → " Собака по имени Полька жила в парке. Её друзья — "), while the
cursor span was present; the cursor disappeared and the bubble read as final (90 chars) the moment the
last sample landed. Cross-checked against a concurrent `adb logcat` capture: native generation for this
exact turn ran token 1 at `16:53:11.646` through `Reached end-of-generation` at `16:53:24.866` (34
tokens, ~13.2s) — matches the DOM growth window (`16:53:12.7`–`16:53:26.0`, given the send-time offset
and 500ms poll granularity) to within about a second. This is a real per-token repaint, not a
synthetic/batch one — closes plan §11 item 6.

Also worth recording for whoever reruns this: the *first* attempt at this script used the same
"find text near the sent message's position in `visibleTexts()`" heuristic as the `enable_thinking`
verification, and it reproduced that exact false positive (a sidebar preview string, coincidentally
close in length to the real reply, read as the "reply" at `+2.8s` — long before generation had even
started per logcat). A second bug in the same first attempt — a stop condition comparing only the two
most recently *recorded* (length-changed) samples' timestamps, rather than time since the last actual
change — caused the loop to exit after just 2 samples once they happened to be >8s apart, even though
generation was still running. Both are fixed in the anchored, cursor-based version now checked in;
worth reading its doc comment before trusting a future variant of this kind of script.
