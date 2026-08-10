import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream, CompletionToken } from '../../core/types.js';
import { AsyncTokenQueue } from '../shared/async-token-queue.js';

/**
 * Controllable `LlmRuntimePort` fake — drives `RuntimeFacade`/`LocalAiClient`
 * unit tests (concurrency, chat-template resolution, cancel/error
 * semantics, TZ §9.4/§9.7/§9.8) without real inference. Records every
 * `complete()` call's resolved `input`/`options` so a test can assert what
 * `RuntimeFacade` actually sent it (e.g. whether templating was skipped).
 */
export class FakeLlmRuntimeAdapter implements LlmRuntimePort {
  readonly completeCalls: Array<{ input: CompletionInput; options?: { skipNativeTemplating?: boolean } }> = [];
  modelLoaded = false;
  embeddingModelLoaded = false;

  /** Tokens to push before settling, and how to settle — configurable per test. */
  scriptedTokens: string[] = ['hello'];
  scriptedOutcome: 'complete' | 'error' | 'hang' = 'complete';
  scriptedEmbedding: Float32Array = new Float32Array([1, 0, 0, 0]);
  scriptedTokenCount = 3;

  async loadModel(): Promise<void> {
    this.modelLoaded = true;
  }

  async loadEmbeddingModel(): Promise<void> {
    this.embeddingModelLoaded = true;
  }

  async releaseModel(): Promise<void> {
    this.modelLoaded = false;
  }

  async releaseEmbeddingModel(): Promise<void> {
    this.embeddingModelLoaded = false;
  }

  complete(
    input: CompletionInput,
    signal?: AbortSignal,
    options?: { skipNativeTemplating?: boolean },
  ): CompletionStream<CompletionResult> {
    this.completeCalls.push({ input, options });
    const queue = new AsyncTokenQueue<CompletionToken>();
    let accumulated = '';

    const result = (async (): Promise<CompletionResult> => {
      if (this.scriptedOutcome === 'hang') {
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve());
        });
        queue.close();
        return { content: accumulated, status: 'cancelled' };
      }

      for (const token of this.scriptedTokens) {
        // Yield a tick between tokens — real streaming is never
        // zero-microtask synchronous, and callers (e.g. RuntimeFacade
        // tests) need a chance to call `AbortController.abort()` between
        // tokens for a mid-stream cancellation to be observable at all.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal?.aborted) break;
        accumulated += token;
        queue.push({ token, accumulatedContent: accumulated });
      }
      queue.close();

      if (signal?.aborted) return { content: accumulated, status: 'cancelled' };
      if (this.scriptedOutcome === 'error') return { content: accumulated, status: 'error' };
      return { content: accumulated, status: 'complete', tokenCount: this.scriptedTokenCount };
    })();

    return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), result };
  }

  async embed(text: string | string[]): Promise<Float32Array | Float32Array[]> {
    return Array.isArray(text) ? text.map(() => this.scriptedEmbedding) : this.scriptedEmbedding;
  }

  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  async bench(): Promise<{ tgAvg: number }> {
    return { tgAvg: 42 };
  }

  async saveSession(): Promise<void> {}

  async loadSession(): Promise<void> {}
}
