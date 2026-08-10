import type { CompletionInput, CompletionOptions, CompletionStream, CompletionResult, CompletionToken } from '../types.js';

/**
 * Port over the native inference runtime — TZ §4.1. The production adapter
 * wraps `llama-cpp-capacitor` (`initLlama`/`completion`/`embedding`/
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
  loadModel(options: { modelPath: string; contextLength: number }): Promise<void>;
  loadEmbeddingModel(options: { modelPath: string }): Promise<void>;

  /** Releases the LLM context only — leaves the embedding context (if loaded) untouched. TZ §5.5. */
  releaseModel(): Promise<void>;
  /** Releases the embedding context only — leaves the LLM context (if loaded) untouched. TZ §5.6. */
  releaseEmbeddingModel(): Promise<void>;

  complete(input: CompletionInput, signal?: AbortSignal): CompletionStream<CompletionResult>;
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
