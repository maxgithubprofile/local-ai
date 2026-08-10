# CLAUDE.md — rules for agentic work in this repo

## What this repo is

`local-ai` — a TS/Capacitor library (offline LLM + embedding, downloads, SQLite/vector store,
multi-chat conversations, device eligibility, lifecycle). The **source of truth** is
[`docs/2026-08-10-local-ai-library-tz.md`](docs/2026-08-10-local-ai-library-tz.md) (referred to
below as "the TZ"). [`ROADMAP.md`](ROADMAP.md) breaks its §15 phases into concrete tasks;
[`docs/decisions.md`](docs/decisions.md) tracks resolutions to the TZ's §16 open questions.

**Never silently contradict or reinterpret the TZ.** If a task requires a decision the TZ leaves
open, check `docs/decisions.md` first. If it's still open, either ask the user or make the smallest
reasonable assumption and log it as a new row in `docs/decisions.md` — don't guess silently and
move on.

## Hard architecture rule: hexagonal boundaries

`src/core/**` contains zero imports from `@capacitor/*`, `@capacitor-community/*`, `@capgo/*`, or
anything under `src/adapters/**`. It depends only on the ports in `src/core/ports/`. This is
enforced by `eslint.config.js`'s `no-restricted-imports` rule on `src/core/**` — a PR that violates
it fails `pnpm lint`, not just review. If a task seems to require `core` reaching into a concrete
adapter, that's a signal the port interface is missing a method, not a reason to bypass the rule.

Production adapters live in `src/adapters/capacitor/`; Node/test adapters implementing the *same*
port live in `src/adapters/node-testing/`. Every port should have both, and a contract test in
`test/contract/` parametrized over both — see the `new-port` skill.

## Testing rule (TZ §13)

Before writing a test, ask: **does this need a phone?**

- **No** (pure logic, fakes, `better-sqlite3`, a local HTTP mock, `node-llama-cpp`) → it's a
  `test/unit` or `test/integration` spec, and it must stay part of `pnpm test` / `npm test`. This is
  the large majority of the codebase — see the TZ §13.1 table before assuming something can't be
  tested in Node.
- **Yes** (real Capacitor bridge, real `@capgo/capacitor-device-info` sensors, real
  `@capgo/capacitor-downloader` backgrounding/process-kill behavior) → it belongs in
  `test/device-e2e/`, is manual/emulator-only, and must never be added to `pnpm test`'s default run.

`test/contract/` holds one scenario set per port, run against every adapter that implements it
(node-testing always; capacitor when a device/emulator is available).

## Coding conventions

- TypeScript `strict: true`, ES2022, dual ESM/CJS build (`tsup`) — see `tsconfig.json`/`tsup.config.ts`.
- Every exported symbol under `src/core/client/`, `src/core/ports/`, `core/errors.ts`, `core/types.ts`
  needs JSDoc — `eslint-plugin-jsdoc` fails the build on a miss (TZ §12).
- Errors: extend `LocalAiError` (`src/core/errors.ts`) with a **stable** `code` string. Once a `code`
  ships, it never changes — consumers switch on it, not on `message`.
- Events: only ever add/consume events through `LocalAiEventMap` (`src/core/types.ts`) — no ad hoc
  string event names elsewhere.
- The public completion API accepts structured `messages`, never a raw prompt string (TZ §4.1) — do
  not add an escape hatch for this, even for convenience.

## Non-negotiable security invariants (TZ §14)

- Hugging Face model source: pinned commit `revision` only — `"main"`/`"HEAD"`/empty must fail
  manifest validation.
- Both model and embedding artifacts: mandatory SHA-256 verification before the file is ever loaded
  into the runtime.
- HTTPS only for every network call the library makes.
- Never execute code contained in a downloaded artifact.

Do not relax any of these for convenience/testing without the user explicitly signing off.

## Phase discipline

Follow `ROADMAP.md`'s task order within a phase; don't start Phase N+1 work that depends on an
unfinished Phase N task. Phase 0 spike tasks produce an ADR under `docs/adr/` (use the `spike`
skill) **before** the dependent implementation task starts — an unresolved spike blocks its
dependents, it doesn't get skipped.

## Definition of done for a task

1. `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` all green.
2. JSDoc present on new public API surface.
3. New port/adapter pairs have a contract test.
4. `ROADMAP.md`'s checkbox for the task is ticked with a short status note (use the `phase-gate`
   skill to check this mechanically before marking a phase complete).

## Skills

- **`spike`** — run a Phase 0 spike, write the ADR, record the decision.
- **`new-port`** — scaffold a new port + prod adapter + fake adapter + contract test symmetrically.
- **`add-migration`** — add the next numbered SQL migration under `src/core/db/migrations/`.
- **`phase-gate`** — check whether a phase's TZ §15 "Критерий готовности" actually passes, and tick it.
