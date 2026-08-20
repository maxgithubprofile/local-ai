import { getLlama, LlamaChat, LlamaCompletion } from 'node-llama-cpp';
import type { Llama, LlamaModel, LlamaContext, LlamaContextSequence, LlamaEmbeddingContext } from 'node-llama-cpp';
import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream, CompletionToken } from '../../core/types.js';
import { RuntimeInitError } from '../../core/errors.js';
import { AsyncTokenQueue } from '../../core/utils/async-token-queue.js';
import { splitReasoningContent } from '../../core/runtime/reasoning-content.js';

type ChatHistoryItem =
  | { type: 'system'; text: string }
  | { type: 'user'; text: string }
  | { type: 'model'; response: string[] };

function toChatHistory(messages: CompletionInput['messages']): ChatHistoryItem[] {
  return messages.map((m): ChatHistoryItem => {
    if (m.role === 'system') return { type: 'system', text: m.content };
    if (m.role === 'assistant') return { type: 'model', response: [m.content] };
    return { type: 'user', text: m.content };
  });
}

/**
 * `node-llama-cpp` as the Node-side `LlmRuntimePort` reference
 * implementation (TZ §13.1) — dev-time use and, per ADR 0001, the fixture
 * this adapter is exercised against under `test/fixtures/stories260K.gguf`
 * (a ~1.2MB TinyStories checkpoint, ggml-org's own tiny CI test model —
 * real inference, not a mock, at a size that runs in milliseconds).
 *
 * Mechanism 1 (TZ §4.1) — `LlamaChat` with `chatWrapper: 'auto'` applies
 * the GGUF's own chat template (or node-llama-cpp's best-guess wrapper) to
 * `input.messages` directly. Mechanism 2 — `options.skipNativeTemplating`
 * (`LlmRuntimePort`'s doc comment) — uses the lower-level `LlamaCompletion`
 * instead, which does *no* templating at all, on the assumption that
 * `RuntimeFacade` already pre-formatted `input.messages` into a single
 * already-templated string (that string is `input.messages[0].content` by
 * convention in that case).
 */
export class NodeLlamaCppAdapter implements LlmRuntimePort {
  private llama: Llama | null = null;

  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private sequence: LlamaContextSequence | null = null;
  private chat: LlamaChat | null = null;

  private embeddingModel: LlamaModel | null = null;
  private embeddingContext: LlamaEmbeddingContext | null = null;

  private async getLlama(): Promise<Llama> {
    if (!this.llama) this.llama = await getLlama();
    return this.llama;
  }

  async loadModel(options: { modelPath: string; contextLength: number }): Promise<void> {
    const llama = await this.getLlama();
    this.model = await llama.loadModel({ modelPath: options.modelPath });
    this.context = await this.model.createContext({ contextSize: options.contextLength });
    this.sequence = this.context.getSequence();
    this.chat = new LlamaChat({ contextSequence: this.sequence, chatWrapper: 'auto' });
  }

  async loadEmbeddingModel(options: { modelPath: string }): Promise<void> {
    const llama = await this.getLlama();
    this.embeddingModel = await llama.loadModel({ modelPath: options.modelPath });
    this.embeddingContext = await this.embeddingModel.createEmbeddingContext();
  }

  async releaseModel(): Promise<void> {
    await this.context?.dispose();
    await this.model?.dispose();
    this.context = null;
    this.sequence = null;
    this.chat = null;
    this.model = null;
  }

  async releaseEmbeddingModel(): Promise<void> {
    await this.embeddingContext?.dispose();
    await this.embeddingModel?.dispose();
    this.embeddingContext = null;
    this.embeddingModel = null;
  }

  complete(
    input: CompletionInput,
    signal?: AbortSignal,
    options?: { skipNativeTemplating?: boolean },
  ): CompletionStream<CompletionResult> {
    if (!this.sequence || !this.chat) {
      throw new RuntimeInitError('NodeLlamaCppAdapter.complete() called before loadModel()');
    }
    const sequence = this.sequence;
    const chat = this.chat;

    const queue = new AsyncTokenQueue<CompletionToken>();
    let accumulated = '';
    const onTextChunk = (text: string): void => {
      accumulated += text;
      queue.push({ token: text, accumulatedContent: accumulated });
    };

    const result = (async (): Promise<CompletionResult> => {
      try {
        if (options?.skipNativeTemplating) {
          const prompt = input.messages[input.messages.length - 1]?.content ?? '';
          const completion = new LlamaCompletion({ contextSequence: sequence });
          try {
            const response = await completion.generateCompletionWithMeta(prompt, {
              signal,
              stopOnAbortSignal: true,
              maxTokens: input.options?.maxTokens,
              temperature: input.options?.temperature,
              topP: input.options?.topP,
              topK: input.options?.topK,
              seed: input.options?.seed,
              customStopTriggers: input.options?.stop,
              onTextChunk,
            });
            const split = splitReasoningContent(response.response);
            return { content: split.content, status: signal?.aborted ? 'cancelled' : 'complete', reasoningContent: split.reasoningContent ?? undefined };
          } finally {
            await completion.dispose();
          }
        }

        const response = await chat.generateResponse(toChatHistory(input.messages), {
          signal,
          stopOnAbortSignal: true,
          maxTokens: input.options?.maxTokens,
          temperature: input.options?.temperature,
          topP: input.options?.topP,
          topK: input.options?.topK,
          seed: input.options?.seed,
          customStopTriggers: input.options?.stop,
          onTextChunk,
        });
        const split = splitReasoningContent(response.response);
        return { content: split.content, status: signal?.aborted ? 'cancelled' : 'complete', reasoningContent: split.reasoningContent ?? undefined };
      } catch (err) {
        // TZ §9.8: mid-generation failures *resolve* with status: 'error', never reject.
        if (signal?.aborted) return { content: accumulated, status: 'cancelled' };
        return { content: accumulated, status: 'error', errorMessage: err instanceof Error ? err.message : String(err) };
      } finally {
        queue.close();
      }
    })();

    return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), result };
  }

  async embed(text: string | string[]): Promise<Float32Array | Float32Array[]> {
    if (!this.embeddingContext) {
      throw new RuntimeInitError('NodeLlamaCppAdapter.embed() called before loadEmbeddingModel()');
    }
    const embeddingContext = this.embeddingContext;
    if (Array.isArray(text)) {
      const results: Float32Array[] = [];
      for (const t of text) {
        const embedding = await embeddingContext.getEmbeddingFor(t);
        results.push(new Float32Array(embedding.vector));
      }
      return results;
    }
    const embedding = await embeddingContext.getEmbeddingFor(text);
    return new Float32Array(embedding.vector);
  }

  async countTokens(text: string): Promise<number> {
    if (!this.model) throw new RuntimeInitError('NodeLlamaCppAdapter.countTokens() called before loadModel()');
    return this.model.tokenize(text).length;
  }

  async saveSession(sessionPath: string): Promise<void> {
    if (!this.sequence) throw new RuntimeInitError('NodeLlamaCppAdapter.saveSession() called before loadModel()');
    await this.sequence.saveStateToFile(sessionPath);
  }

  async loadSession(sessionPath: string): Promise<void> {
    if (!this.sequence) throw new RuntimeInitError('NodeLlamaCppAdapter.loadSession() called before loadModel()');
    await this.sequence.loadStateFromFile(sessionPath, { acceptRisk: true });
  }
}
