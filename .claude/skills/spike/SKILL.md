---
name: spike
description: Run a Phase 0 spike from the local-ai TZ (e.g. verifying llama-cpp-capacitor's real API, sqlite-vec on iOS, capacitor-downloader process-kill survival, device-info accuracy) and record the outcome as an ADR. Use when the task is a TZ §15 Phase 0 row, an item from the §17 risk table, or any "confirm this actually works before committing to it" investigation.
---

# spike

Runs one Phase 0 investigation from `docs/2026-08-10-local-ai-library-tz.md` §15/§17 and turns it
into a durable decision instead of tribal knowledge.

## Steps

1. **Identify the spike** from `ROADMAP.md`'s Phase 0 section (each row links to the TZ section it
   resolves — e.g. §4.1 for `llama-cpp-capacitor`'s real method signatures, §8.3 for `sqlite-vec` on
   iOS, §4.4 for `@capgo/capacitor-downloader` process-kill survival, §4.5 for device-info accuracy).

2. **Investigate.** What's actually verifiable from this environment (reading the plugin's real
   source/types on npm, not trusting its README, per TZ §4.1's explicit warning) vs. what genuinely
   needs a physical device/emulator — say so plainly in the ADR rather than guessing at
   device-only answers.

3. **Create the ADR** at `docs/adr/NNNN-<slug>.md` from `docs/adr/0000-template.md` (next available
   number). Status starts `proposed` unless the investigation was conclusive enough for `accepted`.
   Include what was verified, what wasn't (and why), and the concrete decision — e.g. "adopt
   `llama-cpp-capacitor` 0.1.5, confirmed methods: X, Y, Z; NOT confirmed: session save/load
   signature, needs device".

4. **Update `docs/decisions.md`** if this spike resolves one of the TZ §16 open questions (e.g. §16.13
   confirming `@capgo/capacitor-downloader`) — add/update its row with a link to the new ADR.

5. **Update `ROADMAP.md`** — tick the spike's checkbox, and if the outcome changes a downstream task
   (e.g. the fallback path is needed instead of the primary path), note that on the dependent task
   rather than silently leaving it referencing the old assumption.

## Output

A merged ADR + updated `docs/decisions.md`/`ROADMAP.md` rows — never just a chat answer. The point
of this skill is that the next agent picking up the dependent Phase 1+ task doesn't have to
re-derive the same investigation.
