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
| 7 | Message branching (regenerate/edit-and-resubmit) in v1 | Open | — | — | — |
| 7a | Syncing edits/deletes of individual messages from the host app's own DB (Mode B) | Open | — | — | — |
| 8 | Multi-slot session-cache vs. single-slot for v1 | Open | Bootstrap follows TZ's stated v1 default: single-slot (§9.3) | — | — |
| 9 | Retention policy for `previousModels[]`/`previousEmbeddings[]` | Open | — | — | — |
| 10 | Local DB encryption (SQLCipher) | Open | — | — | — |
| 11 | Monorepo vs. single package | Open | Bootstrap follows TZ's §3.1 recommendation: single package, subpath exports | — | — |
| 12 | Device-e2e CI infrastructure (macOS runners/Android emulators) vs. fully manual | Open | — | — | — |
| 13 | Confirm `@capgo/capacitor-downloader` choice (esp. process-kill survival) | Open | Pending Phase 0 spike | — | — |
| 14 | Default `eligibilityPolicy` (`block` vs `warn` for `'no'`) | Open | Bootstrap follows TZ's stated default: `no → block`, `tight/unknown → warn` (§6.4) — flagged there as a product decision, not final | — | — |
| 15 | How strictly to trust iOS thermal/low-power signals in eligibility | Open | — | — | — |
| 16 | Ship `ConversationSyncApi` (Mode B) in the first release at all | Open | — | — | — |
| 17 | Default `contextStrategy` (`'truncate-oldest'` vs `'fail'`) | Open | Bootstrap follows TZ's stated default: `'truncate-oldest'` (§9.7) — flagged there as a product decision, not final | — | — |
| 18 | Whether `'cancelled'`/`'error'` messages show in UI by default | Open | N/A to the library (consumer-app UI decision) — documented as an integration-guide example only | — | — |
| 19 | Is `LlmRuntimePort.countTokens()` mandatory, or is a heuristic acceptable pre-Phase-4 | Open | Bootstrap scaffolds `countTokens()` as a required port method (matches TZ §10 port shape); heuristic fallback used by the context-policy implementation until Phase 4 wires a real tokenizer | — | — |

## How to resolve a row

1. Get the decision (from the user, or a Phase 0 spike via the `spike` skill).
2. Update `Status` → `Resolved`, fill `Resolution`/`Date`, link an ADR under `docs/adr/` if the
   resolution came from a spike or has non-trivial consequences.
3. If code already encodes the old placeholder assumption, update it in the same change — don't
   leave the ledger and the code disagreeing.
