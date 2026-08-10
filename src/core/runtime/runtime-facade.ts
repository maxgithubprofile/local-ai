import type { LlmRuntimePort } from '../ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream } from '../types.js';
import { RuntimeBusyError } from '../errors.js';
import { formatChatPrompt, type ChatTemplatePreset } from './chat-template-presets.js';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  // Intentionally yields nothing — used when generation never starts.
}

/**
 * Sits between `LocalAiClient` and `LlmRuntimePort`: resolves chat-template
 * formatting (native `messages`-passthrough vs. the built-in preset
 * registry keyed by `ModelArtifact.chatTemplate`, TZ §4.1) and enforces the
 * single-generation concurrency rule (`RuntimeBusyError`, TZ §9.4). Context
 * window policy (TZ §9.7) is applied one layer up, by `LocalAiClient`
 * (Phase 5, task 5.3) before calling in here — this class only owns
 * template resolution + concurrency, per its ROADMAP Phase 4 scope.
 *
 * Per `CompletionStream`'s doc comment (TZ §9.2/§10.0): `complete()` itself
 * never throws — `RuntimeBusyError` surfaces by the returned stream's
 * `result` *rejecting* (and its async-iterable side yielding nothing),
 * exactly like `ContextWindowExceededError` does one layer up.
 */
export class RuntimeFacade {
  private busy = false;

  constructor(private readonly runtime: LlmRuntimePort) {}

  /** True while a generation started through this facade hasn't yet settled. */
  get isBusy(): boolean {
    return this.busy;
  }

  complete(
    input: CompletionInput,
    model: { chatTemplate: ChatTemplatePreset | 'auto' },
    signal?: AbortSignal,
  ): CompletionStream<CompletionResult> {
    if (this.busy) {
      return {
        [Symbol.asyncIterator]: () => emptyAsyncIterable<never>()[Symbol.asyncIterator](),
        result: Promise.reject(new RuntimeBusyError('a generation is already in progress on this runtime, TZ §9.4')),
      };
    }

    const [effectiveInput, skipNativeTemplating] = this.resolveTemplating(input, model.chatTemplate);

    this.busy = true;
    const stream = this.runtime.complete(effectiveInput, signal, { skipNativeTemplating });
    const result = stream.result.finally(() => {
      this.busy = false;
    });

    return { [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](), result };
  }

  /**
   * `'auto'` (mechanism 1) passes `input` through unchanged — the runtime
   * adapter applies the GGUF's own chat template natively. An explicit
   * preset (mechanism 2) pre-formats the full message history into a
   * single string via the preset registry and hands the runtime adapter
   * `skipNativeTemplating: true` so it doesn't re-template it.
   */
  private resolveTemplating(
    input: CompletionInput,
    chatTemplate: ChatTemplatePreset | 'auto',
  ): [CompletionInput, boolean] {
    if (chatTemplate === 'auto') return [input, false];
    const formatted = formatChatPrompt(input.messages, chatTemplate);
    return [{ messages: [{ role: 'user', content: formatted }], options: input.options }, true];
  }
}
