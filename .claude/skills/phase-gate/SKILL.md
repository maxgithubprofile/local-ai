---
name: phase-gate
description: Check whether a local-ai ROADMAP.md phase or task is actually done — runs lint/typecheck/unit/integration tests, checks the phase's TZ "Критерий готовности", and ticks the checkbox with a status note if it passes. Use when the user says a phase/task is finished, asks "is Phase N done", or before closing out a chunk of roadmap work.
---

# phase-gate

The mechanical "is this actually done" check — decouples "I wrote the code" from "the roadmap says
it's done".

## Steps

1. **Identify the target** — a specific task line or a whole phase section in `ROADMAP.md`.

2. **Run the gates:**
   ```
   pnpm lint
   pnpm typecheck
   pnpm test:unit
   pnpm test:integration
   ```
   All four must pass. If the task/phase also has a specific TZ-defined "Критерий готовности" restated
   in `ROADMAP.md` (e.g. Phase 2's "resume after 50% cutoff" contract test, Phase 3's
   `VectorSpaceMismatchError` guard test), confirm that specific test exists and passes — a green
   `pnpm test` alone is necessary but not sufficient if the phase's defining test is missing.

3. **Check side conditions** that automated tests won't catch:
   - New public API surface has JSDoc (spot-check, `eslint-plugin-jsdoc` should already fail the
     build otherwise).
   - New ports have both adapters + a contract test (see `new-port` skill).
   - If the task depended on an open question in `docs/decisions.md`, confirm it's marked resolved,
     not still open.

4. **If everything passes:** tick the checkbox in `ROADMAP.md`, add a one-line status note (date +
   what was verified), and if the task closed out a Phase 0 spike's dependent work, cross-reference
   the ADR.

5. **If something fails:** do not tick the box. Report exactly what failed (test name, lint rule,
   missing JSDoc, etc.) — don't mark partial progress as done.

## Non-negotiable

Never tick a `ROADMAP.md` box on the basis of "the code looks right" alone — only on the gates in
step 2 actually passing.
