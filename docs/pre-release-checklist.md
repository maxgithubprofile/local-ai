# Pre-release checklist

Added 2026-08-11 in response to external consumer feedback (`docs/decisions.md`'s "External consumer
feedback review" entry, item #4): `docs/decisions.md`'s ledger mixes two different kinds of "not done
yet" — questions only the **product owner** can answer, and **engineering** tasks an agent can pick up
and finish unassisted. Interleaved in one list, "Phases 0–8 done" reads as closer to release-ready
than it is. This file re-sorts the same ledger by who acts on each row; it doesn't replace
`docs/decisions.md` (still the source of truth for the resolution text itself) or `ROADMAP.md` (still
the source of truth for engineering task breakdown) — it's a lens over both.

## Needs the product owner's decision — blocks a real `npm publish`

Pulled from `docs/decisions.md`'s `Open` rows that are genuinely product/business calls, not something
an agent should guess past even with a "smallest reasonable assumption" placeholder:

| # | Question | Ledger row |
|---|---|---|
| 1 | npm package name/scope + library license (interacts with the MPL-2.0 downloader dependency, see README's "License note") | [`docs/decisions.md` #1](decisions.md) |
| 2 | Concrete default model + embedding (HF repo, commit SHA, embedding hosting, calibrated `minRamGb`/`recommendedRamGb`) | [#2](decisions.md), [#3](decisions.md) |
| 6 | Chat/message count or size limits | [#6](decisions.md) |
| 9 | Retention policy for `previousModels[]`/`previousEmbeddings[]` | [#9](decisions.md) |
| 10 | Local DB encryption (SQLCipher) | [#10](decisions.md) |
| 14 | Default `eligibilityPolicy` (`block` vs `warn` for `'no'`) — bootstrap follows the TZ's stated default, not yet confirmed as final | [#14](decisions.md) |
| 16 | **Ship `ConversationSyncApi` (Mode B) in the first release at all** — flagged urgent: a real consumer (Forta Chat) is already architecting an integration around it | [#16](decisions.md) |
| 17 | Default `contextStrategy` (`'truncate-oldest'` vs `'fail'`) — same "bootstrap default, not confirmed final" situation as #14 | [#17](decisions.md) |

Row #16 is the one to chase first if a consumer is already integrating — everything else can slip past
a v1 with a documented placeholder, but shipping Mode B's implementation while its release status is
formally `Open` is the kind of gap that surfaces late and expensively.

## Needs a physical device — blocks calling any Capacitor-adapter ADR `accepted`

Every claim in `ROADMAP.md` about `src/adapters/capacitor/**` actually working is currently "API
confirmed from plugin source, runtime behavior unverified" (see README's top-of-file caveat). Re-run
each spike for real before relying on it in production:

| ADR | What needs a device | Blocks |
|---|---|---|
| [0002](adr/0002-sqlite-vec-load-extension.md) | `sqlite-vec` via `loadExtension()` on Android/iOS | Vector search's primary (non-fallback) path |
| [0003](adr/0003-capgo-capacitor-downloader.md) | Resume after app backgrounding *and* process kill | Trusting resume without full re-verify (currently always re-verifies regardless, so functionally safe either way) |
| [0004](adr/0004-capgo-device-info.md) | RAM/thermal accuracy on one real Android + one real iOS device | Eligibility verdict calibration (see the engineering-side row below) |
| [0006](adr/0006-streaming-sha256-timing.md) | Hashing a ~2.5GB file on a mid-range Android device | Confirms (or refutes) that incremental progress UI is actually necessary UX, not just theoretically correct |

## Engineering tasks — an agent can pick these up directly

No product decision or device needed; tracked in `ROADMAP.md`'s "External feedback backlog" section:

- **FB.1** Decompose `LocalAiClient`'s flat `searchMessages`/`exportChat(s)`/`exportLogs`/`clearLogs`
  into namespaced sub-objects (`client.search.*`/`client.export.*`/`client.logs.*`), matching the
  `client.vectors.*`/`client.downloads.*` pattern already used elsewhere — **is** an API-breaking
  change, so confirm the transition approach with the user before starting (see that row for detail).
- **FB.5** `removeModel()`/`removeEmbedding()` — free storage without downloading a replacement
  (`docs/decisions.md` ledger row #20).
- **FB.7** Fill in the "Calibrated thresholds" table in
  [`docs/guides/support-and-eligibility.md`](guides/support-and-eligibility.md) — table exists, needs
  device-side #4 above run first to have real numbers to put in it.
- **Electron desktop support** (row #4 above, resolved 2026-08-29 — see `docs/decisions.md`'s "Electron
  desktop support" entry) — full task breakdown in `ROADMAP.md`'s "Electron desktop support" section.
  Starts with a Phase 0-style native-module-packaging spike, same as any other native-dependency risk
  in this project; not yet started.

## How to use this file

Before treating this library as ready for a real `npm install local-ai@1.0.0` in production: every row
in the first table above needs an actual answer (even "we're deferring this, ship without it" counts,
as long as it's a decision rather than a silent gap), and at minimum ADR 0002/0003 (vector search,
downloads — the two capabilities almost every consumer needs) should move from `proposed` to
`accepted` or `rejected` with a documented fallback. The engineering tasks are independent of both and
can proceed in parallel.
