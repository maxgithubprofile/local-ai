import { initLlama } from 'llama-cpp-pro';
// `llama-cpp-pro`'s real resolved type entry (`dist/esm/index.d.ts`, per its
// `package.json` `exports` map — NOT the stray legacy `types/*.d.ts` also
// shipped in the tarball, which still names this type
// `LlamaCppOAICompatibleMessage` but isn't what TS actually resolves)
// exports this same shape only under its `RNLlama*` legacy alias.
import type { LlamaContext, RNLlamaOAICompatibleMessage as LlamaCppOAICompatibleMessage, CompletionParams } from 'llama-cpp-pro';
import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream, CompletionToken } from '../../core/types.js';
import { RuntimeInitError } from '../../core/errors.js';
import { AsyncTokenQueue } from '../../core/utils/async-token-queue.js';
import { formatChatPrompt } from '../../core/runtime/chat-template-presets.js';
import { splitReasoningContent } from '../../core/runtime/reasoning-content.js';

function toOaiMessages(messages: CompletionInput['messages']): LlamaCppOAICompatibleMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function samplingParams(options: CompletionInput['options']): Pick<
  CompletionParams,
  'n_predict' | 'temperature' | 'top_p' | 'top_k' | 'seed' | 'stop'
> {
  return {
    n_predict: options?.maxTokens,
    temperature: options?.temperature,
    top_p: options?.topP,
    top_k: options?.topK,
    seed: options?.seed,
    stop: options?.stop,
  };
}

/**
 * Wraps `llama-cpp-pro` (formerly `llama-cpp-capacitor`, same project/author
 * under a new npm name — see `docs/adr/0008-llama-cpp-pro-migration.md`;
 * real API confirmed byte-identical to the `.d.ts` read in
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
 *
 * `complete()` also has its own internal, one-shot fallback: if mechanism 1
 * throws before any token has streamed, it retries once with a ChatML
 * prompt built locally (`chatTemplatePresets`'s `'qwen'` preset — ChatML is
 * shared by several current model families, TZ §4.1's own comment on that
 * preset) instead of surfacing a mid-generation failure for a plugin/GGUF
 * quirk the caller has no way to see or control. See the retry's own doc
 * comment in `complete()` for the specific bug this was written for.
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

    // Confirmed on a real Android device, 2026-08-19/20 (device-ai-loop,
    // llama-cpp-pro@0.2.4): this callback never fires. Native generation IS
    // genuinely per-token (logcat's `LlamaCpp`/`RNLlama` tags log "Generating
    // token N..." one at a time, in real time) but the installed package's
    // `android/src/**` Java sources (`LlamaCppPlugin.java`/`LlamaCpp.java`)
    // contain zero `notifyListeners`/`onToken`/`EVENT_ON_TOKEN` code — grepped,
    // confirmed empty — so the JS wrapper's `emit_partial_completion: true` is
    // a no-op on Android; `context.completion()`'s promise only ever resolves
    // once, at the very end, with the full text. This is an upstream
    // llama-cpp-pro Android gap, not fixable from this adapter — see
    // `docs/decisions.md`'s "no per-token streaming on Android" entry (closes
    // ADR 0001/0008's "not verifiable without a device" residual risk, in the
    // negative). Left as-is (not a synthetic-single-chunk workaround) because
    // the caller already gets the full content via `stream.result` either way.
    const onToken = (data: { content?: string; token?: string }): void => {
      const chunk = data.content ?? data.token;
      if (!chunk) return;
      accumulated += chunk;
      queue.push({ token: chunk, accumulatedContent: accumulated });
    };

    // Mechanism 2 (RuntimeFacade-driven): the caller already pre-formatted
    // the full history into a single message via the preset registry.
    const callerFormattedParams: CompletionParams = {
      prompt: input.messages[input.messages.length - 1]?.content ?? '',
      jinja: false,
      ...samplingParams(input.options),
    };
    // Mechanism 1: let the plugin apply the GGUF's own chat template natively.
    const nativeJinjaParams: CompletionParams = {
      messages: toOaiMessages(input.messages),
      jinja: true,
      ...samplingParams(input.options),
    };
    // Internal fallback, not TZ §4.1's own mechanism 2 — used only when
    // mechanism 1 throws (see the retry below), never chosen up front.
    // Appends an already-closed, empty <think></think> block to the prompt
    // — the standard trick to make a Qwen3-family model skip its own
    // reasoning phase (seeing the block already "done", it continues
    // straight to the answer). Mechanism 1's own `enable_thinking: false`
    // can't be used here — that flag only takes effect through the
    // plugin's jinja templating, which is exactly what failed and got us
    // onto this raw-prompt path in the first place. Two real, live-observed
    // problems on this fallback otherwise, 2026-08-20: (1) a chatty
    // reasoning phase can exhaust the entire token budget before the model
    // ever reaches an actual answer — the response resolves 'complete' with
    // nothing but reasoning and no answer at all (caught defensively below
    // regardless); (2) on this adapter's CPU-only target hardware, the
    // reasoning phase alone was costing minutes per reply before any answer
    // token even started.
    const chatmlFallbackParams: CompletionParams = {
      prompt: formatChatPrompt(input.messages, 'qwen') + '<think>\n\n</think>\n\n',
      jinja: false,
      ...samplingParams(input.options),
    };

    const result = (async (): Promise<CompletionResult> => {
      try {
        let native;
        try {
          native = await context.completion(options?.skipNativeTemplating ? callerFormattedParams : nativeJinjaParams, onToken);
        } catch (firstErr) {
          // Some GGUF/plugin-version combinations fail native jinja
          // templating even though the model itself loaded fine — observed
          // live, 2026-08-19: llama-cpp-capacitor threw "Cannot destructure
          // property 'minja' of 'this.model.chatTemplates' as it is
          // undefined" for a model whose chat-template metadata it failed to
          // populate internally, even though tokenize()/loadModel() both
          // succeeded. TZ §4.1 mechanism 2 exists exactly to route around a
          // GGUF/model whose native template can't be trusted — retry with
          // it once, automatically, rather than surfacing a mid-generation
          // failure for something the caller never gets to see or control.
          // Only when: this WAS the native-jinja attempt (a caller already
          // on mechanism 2 has no further fallback), nothing has streamed
          // yet (a partial-output failure is more confusing to silently
          // restart than to just report), and it wasn't a cancellation.
          if (options?.skipNativeTemplating || accumulated !== '' || signal?.aborted) throw firstErr;
          native = await context.completion(chatmlFallbackParams, onToken);
        }
        // native.reasoning_content is only populated when the plugin ran
        // its own template pipeline (mechanism 1) — the ChatML fallback
        // above hands it a raw prompt, so any <think> block still lands
        // raw inside native.content/accumulated. splitReasoningContent()
        // is the net that catches that case too (see its own doc comment).
        const rawContent = native.content || native.text || accumulated;
        const split = splitReasoningContent(rawContent);
        const reasoningContent = native.reasoning_content?.trim() || split.reasoningContent || undefined;
        // The token budget can still run out before the model ever reaches
        // an answer (all reasoning, no conclusion) — confirmed live,
        // 2026-08-20, even with the skip-thinking prefill above (a
        // sufficiently confused/looping context can still burn the whole
        // budget). `status: 'complete'` with empty content would otherwise
        // render as a bubble with nothing in it but a reasoning toggle —
        // indistinguishable from a real bug to the user. Surface it the
        // same way any other failed generation is surfaced instead.
        if (!native.interrupted && split.content.trim() === '') {
          return {
            content: rawContent,
            status: 'error',
            errorMessage: 'Model ran out of its token budget while still reasoning and never produced an answer.',
            reasoningContent,
          };
        }
        return {
          content: split.content,
          status: native.interrupted ? 'cancelled' : 'complete',
          tokenCount: native.tokens_predicted,
          reasoningContent,
        };
      } catch (err) {
        // TZ §9.8: mid-generation failures *resolve* with status: 'error', never reject.
        if (signal?.aborted) return { content: accumulated, status: 'cancelled' };
        return { content: accumulated, status: 'error', errorMessage: err instanceof Error ? err.message : String(err) };
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
