import type { CompletionInput, CompletionOptions, CompletionStream, CompletionResult, CompletionToken } from '../types.js';

/**
 * KV-cache quantization type, perf-tuning plan §6 — deliberately a narrower
 * subset of what the underlying plugin's `cache_type_k`/`cache_type_v`
 * actually accept (`llama-cpp-pro`'s `ContextParams` also allows `'f32'`,
 * `'q4_1'`, `'iq4_nl'`, `'q5_0'`, `'q5_1'`, ...) — these are the only three
 * this port promises to support, keeping the tuning surface small and
 * intentional rather than a pass-through of every native option.
 */
export type KvCacheQuant = 'f16' | 'q8_0' | 'q4_0';

/**
 * Port over the native inference runtime — TZ §4.1. The production adapter
 * wraps `llama-cpp-pro` (formerly `llama-cpp-capacitor`, see
 * `docs/adr/0008-llama-cpp-pro-migration.md`) (`initLlama`/`completion`/`embedding`/
 * `release`/`saveSession`/`loadSession`); the Node adapter wraps
 * `node-llama-cpp` for tests and dev-time use (TZ §13.1). Deliberately has
 * **no LoRA-specific fields** — swapping the native plugin later must not
 * require touching `RuntimeFacade` or anything above it.
 *
 * Chat-template formatting is NOT this port's job when the underlying
 * plugin applies the GGUF's own `tokenizer.chat_template` natively
 * (TZ §4.1 mechanism 1); `RuntimeFacade` only falls back to formatting a
 * raw prompt itself (mechanism 2) when the plugin/model doesn't support
 * that. Either way, callers above `RuntimeFacade` only ever see `messages`.
 */
export interface LlmRuntimePort {
  /**
   * `threads`/`batchSize`/`ubatchSize`/`flashAttention`/`kvCacheQuant` are
   * all optional and additive — `undefined` means "don't pass anything, let
   * the native runtime keep its own default", exactly like every other
   * tuning knob on this port. See
   * `docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md` §3
   * (`threads`), §5 (`batchSize`/`ubatchSize`) and §6
   * (`flashAttention`/`kvCacheQuant`) for why these exist (CPU-only Android
   * perf tuning, TZ-adjacent but not a TZ phase). Unlike the others,
   * `kvCacheQuant` is not just "pass it or don't" — pairing it with
   * `flashAttention: false`/unset is a combination llama.cpp historically
   * doesn't support cleanly, so `LocalAiClient` (not this port) validates
   * that pairing before ever calling `loadModel()` — see its own
   * `resolveRuntimeTuning()` doc comment.
   */
  loadModel(options: {
    modelPath: string;
    contextLength: number;
    threads?: number;
    batchSize?: number;
    ubatchSize?: number;
    flashAttention?: boolean;
    kvCacheQuant?: KvCacheQuant;
  }): Promise<void>;
  loadEmbeddingModel(options: { modelPath: string }): Promise<void>;

  /** Releases the LLM context only — leaves the embedding context (if loaded) untouched. TZ §5.5. */
  releaseModel(): Promise<void>;
  /** Releases the embedding context only — leaves the LLM context (if loaded) untouched. TZ §5.6. */
  releaseEmbeddingModel(): Promise<void>;

  /**
   * `options.skipNativeTemplating` is `RuntimeFacade`'s hook for TZ §4.1
   * mechanism 2: when set, `input.messages` is already a single
   * fully-formatted prompt (`RuntimeFacade` ran it through the chat-template
   * preset registry itself) — the adapter must pass it to the underlying
   * plugin's raw/low-level completion mode instead of re-applying its own
   * native chat-template machinery, which would double-format it. Omitted
   * (or `false`) is mechanism 1 — the default, and the only case most
   * adapters/models ever hit.
   */
  complete(
    input: CompletionInput,
    signal?: AbortSignal,
    options?: { skipNativeTemplating?: boolean },
  ): CompletionStream<CompletionResult>;
  embed(text: string | string[]): Promise<Float32Array | Float32Array[]>;

  /**
   * Token count for a piece of text under the currently loaded model's
   * tokenizer — used by the context-window policy (TZ §9.7) to decide what
   * fits. Whether this is a mandatory part of the contract (vs. an
   * approximation of "chars / 4" being acceptable pre-Phase-4) is an open
   * question — TZ §16.19.
   */
  countTokens(text: string): Promise<number>;

  /** Optional throughput probe used to seed the `'tooSlow'` local verdict, TZ §6.3. */
  bench?(): Promise<{ tgAvg: number }>;

  saveSession(sessionPath: string): Promise<void>;
  loadSession(sessionPath: string): Promise<void>;
}

// Re-exported for adapter implementers' convenience — the port's shape is
// defined entirely in terms of the public completion types (TZ §10.0).
export type { CompletionInput, CompletionOptions, CompletionStream, CompletionResult, CompletionToken };
