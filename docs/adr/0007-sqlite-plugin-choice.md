# 0007. SQLite plugin choice: `@capacitor-community/sqlite`

**Status:** accepted
**Date:** 2026-08-11
**TZ section(s):** §4.2, §8

## Context

TZ §12 lists "choice of SQLite plugin" as its own documentation topic, distinct from ADR 0002's
"does `sqlite-vec` load on top of it" question. This ADR records the former: why
`@capacitor-community/sqlite` specifically, independent of the vector-extension question.

Requirements a Capacitor SQLite plugin needs to satisfy for `local-ai` (TZ §8): a real native SQLite
connection on iOS/Android (not a wrapper around a key-value store), transactions, and — the
differentiator — a **runtime-loadable-extension** hook, since `sqlite-vec` (TZ §4.2/§8.2) has to be
loaded into the same connection as everything else for `VectorStore`'s primary path to work at all.

`@capacitor-community/sqlite@8.1.1` (installed, real API read directly — see ADR 0002 for the
`loadExtension`/`enableLoadExtension` confirmation) was selected over the alternatives considered:

- **`@capacitor/preferences` / other KV-only plugins** — ruled out immediately: no SQL, no
  transactions, wrong tool for `chats`/`chat_messages`/`download_state` (TZ §8.1's relational schema).
- **A hand-rolled native plugin** — rejected as unnecessary engineering cost; `@capacitor-community/sqlite`
  is actively maintained, widely used, and already solves the exact problem.
- **`@op-engineering/op-sqlite`** — a plausible alternative (also wraps native SQLite with extension
  support) not evaluated in depth here, since `@capacitor-community/sqlite` was already sufficient and
  switching cost would only be justified by a `@capacitor-community/sqlite`-specific blocker, which
  the desk research (ADR 0002) didn't find.

Two further points confirmed by reading the package directly (not just documentation):

1. It ships a `src/web.ts` (via `jeep-sqlite`) — unlike the other three native plugins this project
   uses, `sql`/`vectorSearch` capabilities can stay `true` on web if the consuming app sets up
   `jeep-sqlite`'s web component, feeding directly into `SupportChecker`'s per-capability web story
   (ADR 0005).
2. Its high-level API (`SQLiteConnection`/`SQLiteDBConnection`) — `execute(statements)` for
   multi-statement blocks, `run(statement, values)`/`query(statement, values)` for single
   parameterized statements, `beginTransaction()`/`commitTransaction()`/`rollbackTransaction()` — maps
   directly onto `SqlitePort` with no impedance mismatch, confirmed while implementing
   `CapacitorSqliteAdapter` (ROADMAP Phase 3, task 3.3).

## Decision

Adopt `@capacitor-community/sqlite@8.1.1` as the production `SqlitePort` implementation's underlying
plugin (`CapacitorSqliteAdapter`). No further evaluation of alternatives is planned unless a concrete
blocker surfaces on real-device testing (see ADR 0002's own residual risk — the SQLite plugin choice
and the sqlite-vec-loads-on-it question share the same "needs a device" caveat, but are conceptually
separate: even if `sqlite-vec` never loads on iOS, this plugin remains the right choice for the
relational schema alone, since the brute-force `VectorStore` fallback needs nothing more than the
plain SQL this plugin already provides everywhere).

## Consequences

- Confirms `CapacitorSqliteAdapter` (already implemented, Phase 3) has no pending redesign — this ADR
  is documentation of a decision already encoded in working code, not a forward-looking choice.
- If `@capacitor-community/sqlite` turns out to have a real-device-only defect this desk research
  couldn't catch, the fallback is `@op-engineering/op-sqlite` (noted above as the closest alternative)
  — would require a new `SqlitePort` adapter, not a port redesign, since `SqlitePort`'s shape isn't
  specific to this plugin.
