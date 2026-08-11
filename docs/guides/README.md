# Guides

Task-oriented guides for consumers of `local-ai` — TZ §12. Each assumes you've read the
[Quickstart](../../README.md#quickstart) and, for anything touching the manifest, know the shape in
[`manifest-format.md`](./manifest-format.md).

| Guide | Covers |
|---|---|
| [first-run.md](./first-run.md) | Install, assemble ports, `checkSupport()` → `create()` → `ensureReady()` → first message. |
| [support-and-eligibility.md](./support-and-eligibility.md) | `checkSupport()` vs `checkDeviceEligibility()`, `eligibilityPolicy`, the §6.2 threshold table. |
| [multiple-chats.md](./multiple-chats.md) | Creating/switching/deleting chats, `RuntimeBusyError`, session-cache behavior. |
| [mode-b-integration.md](./mode-b-integration.md) | Using `local-ai` as a context-mirror over your own chat history/DB. |
| [independent-model-embedding-updates.md](./independent-model-embedding-updates.md) | `refreshManifest()`, `switchModel()`/`switchEmbedding()`, what each does and doesn't touch. |
| [memory-and-lifecycle.md](./memory-and-lifecycle.md) | `releaseRuntime()`, `autoUnloadOnBackground`, what's actually freed. |
| [testing-consumer-apps.md](./testing-consumer-apps.md) | Testing your own app's `local-ai` integration without a device. |
| [manifest-format.md](./manifest-format.md) | The JSON your `manifestUrl` must serve, field by field, with validation rules. |
