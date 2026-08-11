# minimal-capacitor-app

Worked example of `local-ai`'s API surface — TZ §12, ROADMAP.md Phase 7.6.

**This is illustrative source, not a scaffolded/buildable Capacitor project** — there's no
`capacitor.config.ts`, no `android/`/`ios/` native folders, no bundler config, and `package.json`'s
`local-ai: "workspace:*"` dependency only resolves inside this monorepo-style checkout. Turning it
into a real app is `npx @capacitor/cli create` plus copying `src/*.ts`'s patterns in — the point of
this folder is to show *correct, complete calling code* against `local-ai`'s real, implemented API
(every import here resolves to something that actually exists and is tested — see the root
[`README.md`](../../README.md#whats-verified-vs-not-honestly) for exactly what "tested" means in this
repo), not to be a CI-buildable app.

## What's covered, and where

| Scenario (TZ §12's example-app checklist) | File |
|---|---|
| Assembling the full `LocalAiPorts` set, creating the shared client | [`src/local-ai-setup.ts`](./src/local-ai-setup.ts) |
| "Device not supported" screen (`checkSupport()`, before `create()`) | [`src/eligibility-screen.ts`](./src/eligibility-screen.ts) |
| 2+ independent chats (Mode A), `RuntimeBusyError`/cancellation handling | [`src/chats.ts`](./src/chats.ts) |
| One chat running in Mode B (`upsertChat`/`appendMessages`, host-app-owned history) | [`src/mode-b-chat.ts`](./src/mode-b-chat.ts) |
| Independent embedding update (`switchEmbedding()`, `vector-store:embedding-changed`) | [`src/embedding-update.ts`](./src/embedding-update.ts) |
| Wiring order at app boot | [`src/main.ts`](./src/main.ts) |

Each file's own doc comment cross-references the TZ section and the matching guide under
[`docs/guides/`](../../docs/guides/) for the full explanation — this example is deliberately terse,
the guides carry the "why".

## What's *not* included

A "device not eligible" (as opposed to "not supported at all") screen isn't a separate file — TZ §6.2's
eligibility check is enforced inline by `ensureModelReady()`/`ensureEmbeddingReady()` per
`eligibilityPolicy`, and `chats.ts` shows the `catch (err instanceof DeviceNotEligibleError)` handling
for it directly, reusing `eligibility-screen.ts`'s `describeEligibilityFailure()` helper. Model
updates (`switchModel()`) aren't demonstrated separately since they're structurally identical to
`embedding-update.ts` — see `docs/guides/independent-model-embedding-updates.md` for that half.
