# 0002. `sqlite-vec` via `loadExtension()` (Phase 0 spike 0.2)

**Status:** proposed (desk research only — no Android/iOS device or emulator available in this
environment; see Consequences for what unblocks `accepted`)
**Date:** 2026-08-10
**TZ section(s):** §4.2, §8.2, §8.3

## Context

TZ marks this explicitly as an Android/iOS spike, not a Node one — this environment has neither a
physical device nor an emulator (no Android SDK/Xcode toolchain available here), so the on-device
half of this spike genuinely cannot be run from here. What *was* done:

- `@capacitor-community/sqlite@8.1.1`'s shipped `dist/esm/definitions.d.ts` confirms
  `loadExtension(path: string): Promise<void>` and `enableLoadExtension(toggle: boolean):
  Promise<void>` exist on both the single-connection and the (implied) plugin-level interfaces (two
  matching occurrences at lines ~1423 and ~1557 — instance-level and a `SQLiteDBConnection`-level
  variant). This is a real, typed API, not a README claim.
- `@capacitor-community/sqlite` ships a `src/web.ts` — unlike the other three plugins in this
  project, it *does* support web (via `jeep-sqlite`), which is relevant to `checkSupport()`'s
  per-capability web story (ADR 0005).
- `sqlite-vec@0.1.9`'s npm package ships `getLoadablePath(): string` + `load(db): void` and, per its
  own publishing pipeline (well-documented upstream, `asg017/sqlite-vec`), publishes per-platform
  npm packages including Android (`.so` per ABI) — i.e. the extension itself is real and
  platform-published, not Node-only.
- **Node-level proxy attempt**: tried loading `sqlite-vec` via `better-sqlite3.loadExtension()` in
  this dev sandbox as a best-effort mechanical proxy for "does the loadExtension mechanism work at
  all". This failed for an unrelated reason — `better-sqlite3`'s prebuilt native binary crashes
  (segfault) on this specific host for *any* operation, not just `loadExtension` (confirmed with a
  bare `new Database(':memory:')`, reproduced with a freshly-downloaded tarball bypassing the pnpm
  store, on both the sandboxed Bash tool and native PowerShell). Node's own built-in `node:sqlite`
  works fine in this environment but this Node version (22.12.0) doesn't yet expose
  `loadExtension`/`enableLoadExtension` on `DatabaseSync`. See `docs/decisions.md`'s tooling-notes
  section for the resulting Node-testing-adapter substitution — that engineering workaround is
  unrelated to whether `sqlite-vec` itself works on Android/iOS.
- The historically-known risk here is iOS specifically: Apple ships `libsqlite3.dylib` compiled with
  `SQLITE_OMIT_LOAD_EXTENSION`, which is exactly why `@capacitor-community/sqlite` bundles its own
  SQLite build rather than linking the system one (documented upstream reason for that plugin's
  existence, not independently re-verified here beyond reading its own docs/changelog references to
  "custom SQLite build" — no device to confirm the extension actually `dlopen`s at runtime).

## Decision

**Ship both paths, as ROADMAP already plans (3.5 sqlite-vec primary, 3.6 brute-force fallback —
3.6 ships unconditionally).** `VectorStore`'s sqlite-vec-backed implementation attempts
`sqlitePort.loadVectorExtension()` at startup; on any failure it emits
`vector-store:fallback-active` and callers transparently get the brute-force implementation instead
— no crash, no manual toggle required. This means the *code* doesn't need this ADR's status to be
`accepted` to proceed (ROADMAP already accounts for "ships regardless"), but the *default primary
path for a v1 release* should not be trusted without a real-device pass.

## Consequences

- Unblocks ROADMAP Phase 3 (3.5, 3.6, 3.7, 3.8) — both `VectorStore` implementations get built and
  contract-tested against the same test suite; only the sqlite-vec implementation's "does
  `loadExtension` actually succeed" branch is untestable from this environment (the fallback branch
  of that same code path — extension missing/fails to load — **is** fully testable in Node by
  pointing `loadVectorExtension()` at a bad path, which exercises the exact failure/fallback contract
  a real iOS failure would trigger).
- To move this ADR to `accepted`: run the app on one real or emulated Android device and one real or
  simulated iOS device, confirm `loadExtension()` resolves and a `vec0` virtual table can be created
  and queried on both. Until then, treat sqlite-vec as "implemented, wired, opportunistic" — not
  "verified" — and do not remove or de-prioritize the brute-force path.
- If iOS `loadExtension` turns out to reliably fail even through `@capacitor-community/sqlite`'s
  bundled SQLite build, the resolution is simply: brute-force becomes the *permanent* primary on iOS
  (already an unconditional fallback, no code change needed, only a documentation/default-expectation
  change) — Android can still prefer sqlite-vec independently, since `VectorStore` selection can be
  per-platform.
- Resolves TZ §16.5 in part — `docs/decisions.md` #5 ("is `VectorStore`/`sqlite-vec` mandatory for
  v1") stays open as a *product* question, but this ADR establishes that the library layer treats it
  as non-mandatory (fallback-first) regardless of how #5 is eventually answered.
