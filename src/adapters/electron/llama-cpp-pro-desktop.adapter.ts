import * as http from 'node:http';
import type { LlmRuntimePort, KvCacheQuant } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream, CompletionToken } from '../../core/types.js';
import { RuntimeInitError } from '../../core/errors.js';
import { AsyncTokenQueue } from '../../core/utils/async-token-queue.js';

const LLM_MODEL_ID = 'llm';
const EMBEDDING_MODEL_ID = 'embedding';

/** Minimal slice of `llama-cpp-pro/desktop`'s CJS API this adapter calls — real shapes confirmed by reading `node_modules/llama-cpp-pro/desktop/src/main/{sidecar-manager,sidecar-client,backend-selector}.cjs` directly (docs/adr/0011, 0012). */
export interface LlamaCppProDesktopModule {
  detectBackend(): { selection: unknown };
  createSidecarManager(): SidecarManager;
}

interface SidecarManager {
  start(options?: { selection?: unknown }): Promise<{ ok: boolean; port?: number; reason?: string }>;
  stop(): Promise<void>;
  getClient(): SidecarClient | null;
  getStatus(): { running: boolean; port: number | null };
}

interface SidecarClient {
  loadModel(body: Record<string, unknown>): Promise<{ ok: boolean; model_id: string }>;
  unloadModel(modelId: string): Promise<{ ok: boolean }>;
  embeddings(body: Record<string, unknown>): Promise<{ data: Array<{ embedding: number[] }> }>;
}

/** One parsed `chat.completion.chunk`/`text_completion` SSE data line — see `docs/adr/0012` for the confirmed real shape. */
interface SseChatChunk {
  choices?: Array<{ delta?: { content?: string }; text?: string; finish_reason?: string | null }>;
}

/**
 * Real per-token SSE reader against the sidecar's `POST /v1/chat/completions`/
 * `/v1/completions` (`stream: true`) — `sidecar-client.cjs`'s own
 * `chatCompletion()`/`completion()` buffer the full response and can't be
 * reused here (ADR 0012). `injectedRequest` exists purely for unit-testing
 * this parsing logic against a fake stream without a real sidecar process.
 */
function streamSse(
  port: number,
  path: string,
  body: Record<string, unknown>,
  onChunk: (chunk: SseChatChunk) => void,
  signal: AbortSignal | undefined,
  injectedRequest: typeof http.request = http.request,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = injectedRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        signal,
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => reject(new Error(`Sidecar HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`)));
          return;
        }
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (text: string) => {
          buffer += text;
          for (;;) {
            const sep = buffer.indexOf('\n\n');
            if (sep === -1) break;
            const line = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (!line.startsWith('data: ')) continue;
            const data = line.slice('data: '.length);
            if (data === '[DONE]') continue;
            try {
              onChunk(JSON.parse(data) as SseChatChunk);
            } catch {
              // A malformed SSE line is a server-side bug, not something a
              // single generation should die over — skip it, same
              // best-effort spirit as every other adapter's mid-stream
              // parsing here.
            }
          }
        });
        res.on('end', () => resolve());
        res.on('error', reject);
      },
    );
    req.on('error', (err) => {
      // An aborted request surfaces here as an AbortError — the caller
      // checks `signal?.aborted` itself to distinguish that from a real
      // network failure (TZ §9.8), same convention as every other adapter.
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Real `LlmRuntimePort` for Electron's main process, wrapping
 * `llama-cpp-pro/desktop`'s sidecar subsystem — TZ v6 §4.1, ELEC.1.1a.
 * Confirmed working end-to-end in this environment against a real sidecar
 * binary and a real GGUF model (`docs/adr/0011-electron-sidecar-build.md`):
 * real streaming tokens, real embeddings, real load/unload. Protocol
 * capabilities and gaps are documented in
 * `docs/adr/0012-electron-sidecar-streaming.md` — this class's
 * `countTokens()`/`saveSession()`/`loadSession()` implementations exist
 * specifically *because* the sidecar's HTTP API can't do better yet, not by
 * oversight; re-check that ADR before "fixing" any of the three.
 *
 * One shared sidecar process hosts both the LLM and embedding models as two
 * independently-addressable `model_id`s (`'llm'`/`'embedding'`) via
 * `POST /v1/internal/models/load` — the process itself is started lazily on
 * first `loadModel()`/`loadEmbeddingModel()` call (no `--model` CLI arg, per
 * `sidecar-manager.cjs`'s own support for that) and stopped only once
 * *both* models are released, so releasing one independently (TZ §5.5/§5.6)
 * never tears down the other's context.
 */
export class LlamaCppProDesktopAdapter implements LlmRuntimePort {
  private manager: SidecarManager | null = null;
  private llmLoaded = false;
  private embeddingLoaded = false;

  constructor(private readonly desktop: LlamaCppProDesktopModule) {}

  private async ensureStarted(): Promise<{ manager: SidecarManager; client: SidecarClient; port: number }> {
    if (!this.manager || !this.manager.getStatus().running) {
      const { selection } = this.desktop.detectBackend();
      const manager = this.desktop.createSidecarManager();
      const started = await manager.start({ selection });
      if (!started.ok || !started.port) {
        throw new RuntimeInitError(`llama-cpp-pro desktop sidecar failed to start: ${started.reason ?? 'unknown'}`);
      }
      this.manager = manager;
    }
    const client = this.manager.getClient();
    const port = this.manager.getStatus().port;
    if (!client || port === null) {
      throw new RuntimeInitError('llama-cpp-pro desktop sidecar manager reports running but has no client/port');
    }
    return { manager: this.manager, client, port };
  }

  private async maybeStopManager(): Promise<void> {
    if (!this.llmLoaded && !this.embeddingLoaded && this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  async loadModel(options: {
    modelPath: string;
    contextLength: number;
    threads?: number;
    batchSize?: number;
    ubatchSize?: number;
    flashAttention?: boolean;
    kvCacheQuant?: KvCacheQuant;
  }): Promise<void> {
    const { client } = await this.ensureStarted();
    // batchSize/ubatchSize/flashAttention/kvCacheQuant have no equivalent
    // field in POST /v1/internal/models/load's body (confirmed by reading
    // cap-native-server.cpp's handler, same source-reading pass as ADR
    // 0012) — silently unsupported on Electron specifically, same posture
    // ADR 0012 documents for the completion-time sampling options.
    const loaded = await client.loadModel({
      model_id: LLM_MODEL_ID,
      path: options.modelPath,
      n_ctx: options.contextLength,
      ...(options.threads !== undefined ? { n_threads: options.threads } : {}),
    });
    if (!loaded.ok) throw new RuntimeInitError(`sidecar failed to load model at ${options.modelPath}`);
    this.llmLoaded = true;
  }

  async loadEmbeddingModel(options: { modelPath: string }): Promise<void> {
    const { client } = await this.ensureStarted();
    const loaded = await client.loadModel({ model_id: EMBEDDING_MODEL_ID, path: options.modelPath, embedding: true });
    if (!loaded.ok) throw new RuntimeInitError(`sidecar failed to load embedding model at ${options.modelPath}`);
    this.embeddingLoaded = true;
  }

  async releaseModel(): Promise<void> {
    if (!this.llmLoaded || !this.manager) return;
    await this.manager.getClient()?.unloadModel(LLM_MODEL_ID).catch(() => undefined);
    this.llmLoaded = false;
    await this.maybeStopManager();
  }

  async releaseEmbeddingModel(): Promise<void> {
    if (!this.embeddingLoaded || !this.manager) return;
    await this.manager.getClient()?.unloadModel(EMBEDDING_MODEL_ID).catch(() => undefined);
    this.embeddingLoaded = false;
    await this.maybeStopManager();
  }

  complete(
    input: CompletionInput,
    signal?: AbortSignal,
    options?: { skipNativeTemplating?: boolean },
  ): CompletionStream<CompletionResult> {
    if (!this.llmLoaded || !this.manager) {
      throw new RuntimeInitError('LlamaCppProDesktopAdapter.complete() called before loadModel()');
    }
    const port = this.manager.getStatus().port;
    if (port === null) throw new RuntimeInitError('LlamaCppProDesktopAdapter.complete() — sidecar has no port');

    const queue = new AsyncTokenQueue<CompletionToken>();
    let accumulated = '';
    const mechanism2 = options?.skipNativeTemplating === true;
    const path = mechanism2 ? '/v1/completions' : '/v1/chat/completions';
    // topP/topK/seed/stop/repeatPenalty have no field in the sidecar's
    // request body — confirmed by reading cap-native-server.cpp directly
    // (docs/adr/0012, ledger row #27) — silently unsupported on Electron
    // specifically until the sidecar's protocol grows them, same posture
    // as loadModel()'s batchSize/etc. above.
    const body: Record<string, unknown> = {
      model: LLM_MODEL_ID,
      max_tokens: input.options?.maxTokens ?? 256,
      temperature: input.options?.temperature ?? 0.7,
      stream: true,
      ...(mechanism2
        ? { prompt: input.messages[input.messages.length - 1]?.content ?? '' }
        : { messages: input.messages.map((m) => ({ role: m.role, content: m.content })) }),
    };

    const result = (async (): Promise<CompletionResult> => {
      try {
        await streamSse(port, path, body, (chunk) => {
          const choice = chunk.choices?.[0];
          const text = mechanism2 ? choice?.text : choice?.delta?.content;
          if (!text) return;
          accumulated += text;
          queue.push({ token: text, accumulatedContent: accumulated });
        }, signal);
        // No server-side cancellation exists (ADR 0012) — an aborted
        // signal only stops *this* client from reading further tokens,
        // the sidecar itself finishes generating unseen. `status` still
        // reports 'cancelled' correctly either way, TZ §9.8.
        return { content: accumulated, status: signal?.aborted ? 'cancelled' : 'complete' };
      } catch (err) {
        if (signal?.aborted) return { content: accumulated, status: 'cancelled' };
        return { content: accumulated, status: 'error', errorMessage: err instanceof Error ? err.message : String(err) };
      } finally {
        queue.close();
      }
    })();

    return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), result };
  }

  async embed(text: string | string[]): Promise<Float32Array | Float32Array[]> {
    if (!this.embeddingLoaded || !this.manager) {
      throw new RuntimeInitError('LlamaCppProDesktopAdapter.embed() called before loadEmbeddingModel()');
    }
    const client = this.manager.getClient();
    if (!client) throw new RuntimeInitError('LlamaCppProDesktopAdapter.embed() — sidecar has no client');
    const inputs = Array.isArray(text) ? text : [text];
    const response = await client.embeddings({ model: EMBEDDING_MODEL_ID, input: inputs });
    const vectors = response.data.map((d) => new Float32Array(d.embedding));
    return Array.isArray(text) ? vectors : vectors[0]!;
  }

  /**
   * No tokenize endpoint exists on the sidecar (`docs/adr/0012`, ledger row
   * #25) — `llama_cap_tokenize()` is an internal C function, never exposed
   * over HTTP. Falls back to the chars/4 heuristic unconditionally on this
   * platform, a deliberate, documented deviation from row #19's "no
   * heuristic needed" claim for the other two adapters, not an oversight.
   */
  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  /**
   * No session/KV-cache persistence endpoint exists on the sidecar
   * (`docs/adr/0012`, ledger row #26) — every completion reprocesses the
   * full prompt from scratch server-side regardless. `saveSession()` is a
   * deliberate no-op; `loadSession()` deliberately always throws so
   * `SessionCache.activate()`'s already-tested "corrupt/incompatible load →
   * cold start" fallback handles this automatically rather than a new code
   * path being needed elsewhere. TZ §9.3's "second response is measurably
   * faster" claim does not hold on Electron — see
   * `docs/guides/electron-integration.md`.
   */
  async saveSession(_sessionPath: string): Promise<void> {
    // Intentional no-op — see this method's own doc comment.
  }

  async loadSession(_sessionPath: string): Promise<void> {
    throw new RuntimeInitError('LlamaCppProDesktopAdapter has no session persistence — see docs/adr/0012');
  }
}
