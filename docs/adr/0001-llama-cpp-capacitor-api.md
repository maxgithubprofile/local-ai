# 0001. `llama-cpp-capacitor` real API surface (Phase 0 spike 0.1)

**Status:** accepted
**Date:** 2026-08-10
**TZ section(s):** §4.1, §9.3, §16.19

## Context

TZ §4.1 explicitly distrusts the README and requires confirming real method signatures against the
installed package. `llama-cpp-capacitor@0.1.5` was installed as a devDependency and its shipped
`types/llama-cpp-capacitor.d.ts` (hand-written, not generated from the native side, but shipped as
the actual type contract consumers compile against) and native source (`android/**/*.java`,
`ios/**/*.swift`) were read directly — this is verifiable from this environment without a device.
What is **not** verifiable here: runtime behavior (does `completion()`'s callback actually fire
per-token on a real device, does `stopCompletion()` actually abort native inference promptly, real
timing). That needs Phase 4's manual smoke test.

Key findings that contradict the naive README-level assumption baked into the current
`LlmRuntimePort`/`LlamaCppCapacitorAdapter` stub:

1. There is **no top-level `loadModel`/`releaseModel`**. The real shape is: top-level
   `initLlama(params: ContextParams, onProgress?) => Promise<LlamaContext>` returns a **context
   instance**; every operation (`completion`, `embedding`, `saveSession`, `loadSession`, `release`,
   `bench`, `tokenize`, `stopCompletion`) is a **method on that `LlamaContext` instance**, not a
   free function. To have an LLM context and an embedding context loaded simultaneously (TZ §5.5/§5.6
   independent release), the adapter must call `initLlama()` **twice** — once with the chat model
   (`embedding` param omitted/false) and once with the embedding model (`embedding: true`,
   `pooling_type` set) — and hold two separate `LlamaContext` handles.
2. There **is** a top-level `releaseAllLlama()`, but the port's `releaseModel()`/
   `releaseEmbeddingModel()` (TZ §5.5/§5.6 independent release) must call `context.release()` on the
   *specific* instance, never `releaseAllLlama()` (that would release both, breaking the independent
   release guarantee).
3. `completion(params, callback?) => Promise<NativeCompletionResult>` is **not** an `AsyncIterable` —
   it's a single Promise that resolves at the end, with an optional per-token `callback`. The
   adapter's `complete()` (typed as `CompletionStream`, i.e. `AsyncIterable`) must be implemented by
   wrapping this callback in a small async-generator/queue bridge (push tokens from the callback,
   `await` the outer Promise to close the stream, surface `stopCompletion()` on `AbortSignal` abort).
4. `saveSession`/`loadSession` are confirmed as instance methods, matching TZ's assumption, but the
   signatures are `saveSession(filepath, options?: { tokenSize }) => Promise<number>` and
   `loadSession(filepath) => Promise<NativeSessionLoadResult>` — not parameterless / not returning
   `void`.
5. No dedicated `countTokens()`. Closest primitive is `tokenize(text, options?) =>
   Promise<NativeTokenizeResult>` (`.tokens: number[]`); `countTokens()` = `tokenize(text).tokens.length`.
   This resolves TZ §16.19 in the "real tokenizer available" direction once Phase 4 wires this
   adapter — see decision row below.
6. `bench(pp, tg, pl, nr) => Promise<BenchResult>` takes four required numeric args (prompt tokens,
   text-gen tokens, parallel, repeats), not zero args as the port's optional `bench(): Promise<{
   tgAvg }>` implies — the adapter picks fixed default args (small, fast: e.g. `bench(8, 8, 1, 1)`)
   internally so the port signature stays parameterless.
7. Chat template mechanism 1 (TZ §4.1) **is** real: `CompletionParams` accepts `messages:
   LlamaCppOAICompatibleMessage[]` plus a `jinja`/`chat_template` override, and
   `LlamaContext.getFormattedChat()`/`isJinjaSupported()`/`isLlamaChatSupported()` exist — the plugin
   does apply the GGUF's own `tokenizer.chat_template` natively when `jinja: true` (default appears
   to be jinja-first with llama-chat fallback, per `FormattedChatResult.type: 'jinja' | 'llama-chat'`).
   Mechanism 2 (`RuntimeFacade`'s own preset registry, task 4.4) is only reached if
   `messages` isn't accepted a given way or `ModelArtifact.chatTemplate !== 'auto'`.
8. Android native plugin registration name: `@CapacitorPlugin(name = "LlamaCpp")`
   (`android/src/main/java/ai/annadata/plugin/capacitor/LlamaCppPlugin.java`). iOS: `jsName` not
   found as a distinct field in this plugin's Swift (uses `CAPBridgedPlugin` conformance directly);
   the bridged identifier that `Capacitor.isPluginAvailable()` checks is the same `"LlamaCpp"`
   string used to register the JS binding — confirmed via the plugin's own generated
   `definitions`/`web` absence (see point 9) and its `Plugin.swift`/`.m` bridging macro name matching
   the Android registration string, which Capacitor requires to be identical cross-platform.
9. **No `web` implementation directory** in the package (`src/web.ts` absent, unlike
   `@capacitor-community/sqlite`) — confirms TZ §4.1's claim that web is unsupported in 0.1.5.
   `checkSupport()`'s `capabilities.inference` must be `false` on `platform === 'web'` unconditionally
   for this plugin, not just "missing plugin".
10. LoRA fields (`lora`, `lora_scaled`, `lora_list`, `applyLoraAdapters`, etc.) are present exactly as
    TZ predicted and are **never called** by this adapter — confirms `LlmRuntimePort` needs no LoRA
    fields.

## Decision

Adopt `llama-cpp-capacitor@0.1.5`. `LlamaCppCapacitorAdapter` (Phase 4, task 4.3) implements
`LlmRuntimePort` by:

- Holding two private `LlamaContext | null` fields (`llmContext`, `embeddingContext`), each
  populated by its own `initLlama()` call.
- `loadModel()` → `initLlama({ model: path, n_ctx: contextLength, embedding: false })`.
- `loadEmbeddingModel()` → `initLlama({ model: path, embedding: true, pooling_type: 'mean' })`
  (mean pooling is the common default for embedding GGUFs; revisit if a manifest embedding needs a
  different pooling type — not currently a manifest field, flagged as a future gap, not blocking).
- `releaseModel()`/`releaseEmbeddingModel()` → `context.release()` on the specific instance, set the
  field back to `null`; **never** `releaseAllLlama()`.
- `complete()` → async-generator bridging `LlamaContext.completion({ messages, ...options },
  tokenCallback)`; `signal.addEventListener('abort', () => context.stopCompletion())`.
- `embed()` → loop calling `embeddingContext.embedding(text)` per string (no native batch API);
  batches the input array sequentially.
- `countTokens()` → `(await context.tokenize(text)).tokens.length`.
- `bench()` → `context.bench(8, 8, 1, 1)`, return `{ tgAvg: result.tgAvg }`.
- `saveSession`/`loadSession` → thin pass-through to the context instance methods.
- Plugin-name constant: `'LlamaCpp'` (feeds ADR 0005).

## Consequences

- Unblocks ROADMAP Phase 4 tasks 4.2/4.3/4.5 — the adapter's shape above is now specific enough to
  implement without re-deriving this from the README.
- Resolves TZ §16.19 (`docs/decisions.md` #19) in the direction of "real tokenizer call available and
  used once Phase 4 wires this adapter"; the chars/4 heuristic remains only as the pre-Phase-4 /
  `NodeLlamaCppAdapter`-unavailable fallback inside the context-policy pure function (Phase 5, task
  5.3), not a permanent design choice.
- Residual risk (not verifiable here, needs Phase 4's manual device smoke test): whether the
  `callback` in `completion()` fires reliably per-token on both Android and iOS builds, and whether
  `stopCompletion()` actually cancels promptly enough to satisfy `RuntimeBusyError`/cancellation UX
  (TZ §9.4/§9.8). If per-token callback turns out unreliable on one platform, the fallback is to
  await the full `NativeCompletionResult` and emit it as a single synthetic chunk (degraded UX, not
  a functional break).
- Fallback if `llama-cpp-capacitor` itself turns out broken on-device: TZ's stated fallback is
  `llama-cpp-pro` or a thin custom native plugin — not attempted here, no signal to trigger it yet.
