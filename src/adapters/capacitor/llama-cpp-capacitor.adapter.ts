import { initLlama } from 'llama-cpp-capacitor';
import type { LlamaContext, LlamaCppOAICompatibleMessage } from 'llama-cpp-capacitor';
import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream, CompletionToken } from '../../core/types.js';
import { RuntimeInitError } from '../../core/errors.js';
import { AsyncTokenQueue } from '../shared/async-token-queue.js';

function toOaiMessages(messages: CompletionInput['messages']): LlamaCppOAICompatibleMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Wraps `llama-cpp-capacitor` (real API confirmed in
 * `docs/adr/0001-llama-cpp-capacitor-api.md`). The plugin's shape is
 * **instance-based**: `initLlama()` returns a `LlamaContext` per model, not
 * a global "current model" — this adapter holds two independent contexts
 * (`llmContext`, `embeddingContext`) so `releaseModel()`/`releaseEmbeddingModel()`
 * can release one without touching the other (TZ §5.5/§5.6), and never
 * calls the plugin's `releaseAllLlama()` for that same reason (it would
 * release both).
 *
 * Mechanism 1 (TZ §4.1) — passing `messages` + `jinja: true` lets the
 * plugin apply the GGUF's own chat template natively. Mechanism 2
 * (`options.skipNativeTemplating`) — passes a single already-formatted
 * `prompt` string instead (`RuntimeFacade` did the formatting), with
 * `jinja: false` so the plugin doesn't try to template it again.
 */
export class LlamaCppCapacitorAdapter implements LlmRuntimePort {
  private llmContext: LlamaContext | null = null;
  private embeddingContext: LlamaContext | null = null;

  async loadModel(options: { modelPath: string; contextLength: number }): Promise<void> {
    this.llmContext = await initLlama({ model: options.modelPath, n_ctx: options.contextLength, embedding: false });
  }

  async loadEmbeddingModel(options: { modelPath: string }): Promise<void> {
    this.embeddingContext = await initLlama({ model: options.modelPath, embedding: true, pooling_type: 'mean' });
  }

  async releaseModel(): Promise<void> {
    await this.llmContext?.release();
    this.llmContext = null;
  }

  async releaseEmbeddingModel(): Promise<void> {
    await this.embeddingContext?.release();
    this.embeddingContext = null;
  }

  complete(
    input: CompletionInput,
    signal?: AbortSignal,
    options?: { skipNativeTemplating?: boolean },
  ): CompletionStream<CompletionResult> {
    if (!this.llmContext) {
      throw new RuntimeInitError('LlamaCppCapacitorAdapter.complete() called before loadModel()');
    }
    const context = this.llmContext;

    const queue = new AsyncTokenQueue<CompletionToken>();
    let accumulated = '';
    const onAbort = (): void => {
      context.stopCompletion().catch(() => undefined);
    };
    signal?.addEventListener('abort', onAbort);

    const result = (async (): Promise<CompletionResult> => {
      try {
        const completionParams = options?.skipNativeTemplating
          ? {
              prompt: input.messages[input.messages.length - 1]?.content ?? '',
              jinja: false,
              n_predict: input.options?.maxTokens,
              temperature: input.options?.temperature,
              top_p: input.options?.topP,
              top_k: input.options?.topK,
              seed: input.options?.seed,
              stop: input.options?.stop,
            }
          : {
              messages: toOaiMessages(input.messages),
              jinja: true,
              n_predict: input.options?.maxTokens,
              temperature: input.options?.temperature,
              top_p: input.options?.topP,
              top_k: input.options?.topK,
              seed: input.options?.seed,
              stop: input.options?.stop,
            };

        const native = await context.completion(completionParams, (data) => {
          const chunk = data.content ?? data.token;
          if (!chunk) return;
          accumulated += chunk;
          queue.push({ token: chunk, accumulatedContent: accumulated });
        });
        return {
          content: native.content || native.text || accumulated,
          status: native.interrupted ? 'cancelled' : 'complete',
          tokenCount: native.tokens_predicted,
        };
      } catch {
        // TZ §9.8: mid-generation failures *resolve* with status: 'error', never reject.
        if (signal?.aborted) return { content: accumulated, status: 'cancelled' };
        return { content: accumulated, status: 'error' };
      } finally {
        signal?.removeEventListener('abort', onAbort);
        queue.close();
      }
    })();

    return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), result };
  }

  async embed(text: string | string[]): Promise<Float32Array | Float32Array[]> {
    if (!this.embeddingContext) {
      throw new RuntimeInitError('LlamaCppCapacitorAdapter.embed() called before loadEmbeddingModel()');
    }
    const context = this.embeddingContext;
    if (Array.isArray(text)) {
      const results: Float32Array[] = [];
      for (const t of text) {
        const r = await context.embedding(t);
        results.push(new Float32Array(r.embedding));
      }
      return results;
    }
    const r = await context.embedding(text);
    return new Float32Array(r.embedding);
  }

  async countTokens(text: string): Promise<number> {
    const context = this.llmContext ?? this.embeddingContext;
    if (!context) throw new RuntimeInitError('LlamaCppCapacitorAdapter.countTokens() called before loadModel()');
    const result = await context.tokenize(text);
    return result.tokens.length;
  }

  /** TZ §6.3's `bench()` — fixed small args (8 prompt tokens, 8 text-gen tokens, 1 parallel, 1 repeat) so the port stays parameterless. */
  async bench(): Promise<{ tgAvg: number }> {
    if (!this.llmContext) throw new RuntimeInitError('LlamaCppCapacitorAdapter.bench() called before loadModel()');
    const result = await this.llmContext.bench(8, 8, 1, 1);
    return { tgAvg: result.tgAvg };
  }

  async saveSession(sessionPath: string): Promise<void> {
    if (!this.llmContext) throw new RuntimeInitError('LlamaCppCapacitorAdapter.saveSession() called before loadModel()');
    await this.llmContext.saveSession(sessionPath);
  }

  async loadSession(sessionPath: string): Promise<void> {
    if (!this.llmContext) throw new RuntimeInitError('LlamaCppCapacitorAdapter.loadSession() called before loadModel()');
    await this.llmContext.loadSession(sessionPath);
  }
}
