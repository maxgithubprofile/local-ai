import * as fs from 'node:fs/promises';
import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream, CompletionToken } from '../../core/types.js';
import { AsyncTokenQueue } from '../../core/utils/async-token-queue.js';

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
  /** Records the exact `modelPath`/`threads` each call received — lets tests assert `LocalAiClient` resolved the path and forwarded `runtimeTuning.threads` correctly. */
  readonly loadModelCalls: Array<{ modelPath: string; contextLength: number; threads?: number }> = [];
  readonly loadEmbeddingModelCalls: Array<{ modelPath: string }> = [];

  /** Tokens to push before settling, and how to settle — configurable per test. */
  scriptedTokens: string[] = ['hello'];
  scriptedOutcome: 'complete' | 'error' | 'hang' = 'complete';
  scriptedEmbedding: Float32Array = new Float32Array([1, 0, 0, 0]);
  scriptedTokenCount = 3;

  // Optional here even though LlmRuntimePort declares these required —
  // several pre-existing tests call loadModel()/loadEmbeddingModel() with no
  // args just to flip modelLoaded/embeddingModelLoaded on, and don't care
  // about the path.
  async loadModel(options?: { modelPath: string; contextLength: number; threads?: number }): Promise<void> {
    if (options) this.loadModelCalls.push(options);
    this.modelLoaded = true;
  }

  async loadEmbeddingModel(options?: { modelPath: string }): Promise<void> {
    if (options) this.loadEmbeddingModelCalls.push(options);
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

  readonly savedSessionPaths: string[] = [];
  readonly loadedSessionPaths: string[] = [];
  /** Simulates a corrupt/incompatible-version session file (TZ §9.3's rebuild-from-SQL fallback trigger). */
  shouldFailLoadSession = false;

  /**
   * Writes/reads a trivial real file at `sessionPath` — real runtime
   * adapters (`NodeLlamaCppAdapter`/`LlamaCppCapacitorAdapter`) genuinely
   * write bytes to that path via the native plugin, and `SessionCache`
   * decides cold-start-vs-cache-hit by checking `FileSystemPort.exists()`
   * on it — a no-op fake here would silently break every
   * `SessionCache` test that checks for the file's presence.
   *
   * Deliberately does **not** create `sessionPath`'s parent directory —
   * confirmed live on Android, 2026-08-20, that the real native plugin
   * (`llama-cpp-pro`'s `saveSessionNative`) doesn't either, and nothing else
   * in `SessionCache`'s lifecycle used to create `sessions/` before the
   * first save. This fake used to auto-`mkdir` here, which meant this exact
   * bug (every session save on a fresh install/chat silently failing) had
   * no way to reproduce in `pnpm test` — the fix now lives in
   * `SessionCache.save()` itself, so this fake matches the real plugin's
   * behavior instead of papering over the gap.
   */
  async saveSession(sessionPath: string): Promise<void> {
    this.savedSessionPaths.push(sessionPath);
    await fs.writeFile(sessionPath, 'fake-session-marker');
  }

  async loadSession(sessionPath: string): Promise<void> {
    this.loadedSessionPaths.push(sessionPath);
    if (this.shouldFailLoadSession) throw new Error('simulated corrupt/incompatible session file');
  }
}
