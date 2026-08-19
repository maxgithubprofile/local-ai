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
