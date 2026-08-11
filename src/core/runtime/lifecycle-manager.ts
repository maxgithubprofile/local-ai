import type { LlmRuntimePort } from '../ports/llm-runtime.port.js';
import type { SqlitePort } from '../ports/sqlite.port.js';
import type { AppLifecyclePort } from '../ports/app-lifecycle.port.js';
import type { Unsubscribe } from '../types.js';

/**
 * Implements `releaseRuntime()`'s exact TZ §11.1 boundary — releases the
 * LLM/embedding runtime contexts (separately) and optionally closes
 * SQLite. **Never** touches on-disk model/embedding files, chats,
 * `download_state`, or session-cache *files* (only an in-memory handle to
 * one, which lives on `SessionCache`/`LocalAiClient`, not here — this
 * class only owns the runtime-context/DB half of the reset;
 * `LocalAiClient.releaseRuntime()` composes it with resetting its own
 * in-memory manifest cache and `SessionCache`'s hot pointer, TZ §11.1's
 * other listed cache). Idempotent — every port method it calls
 * (`releaseModel`/`releaseEmbeddingModel`/`close`) is itself idempotent on
 * every adapter in this repo (safe to call with nothing loaded).
 *
 * Also owns the optional `autoUnloadOnBackground` wiring over
 * `AppLifecyclePort` (TZ §11.2): releases on backgrounding, deliberately
 * does **not** eagerly reload on refocus — the next `ensureModelReady()`/
 * `complete()`/etc. call lazily raises the context again on its own.
 */
export class LifecycleManager {
  private backgroundSubscription: Unsubscribe | null = null;

  constructor(
    private readonly llmRuntime: LlmRuntimePort,
    private readonly sqlite: SqlitePort,
  ) {}

  async releaseRuntime(options?: { closeDatabase?: boolean }): Promise<void> {
    await this.llmRuntime.releaseModel();
    await this.llmRuntime.releaseEmbeddingModel();
    if (options?.closeDatabase) {
      await this.sqlite.close();
    }
  }

  /**
   * Subscribes to `appLifecycle.onStateChange()` and releases the runtime
   * whenever the app backgrounds — a no-op until this is called (i.e.
   * `LocalAiConfig.autoUnloadOnBackground` defaults to not wiring this at
   * all, TZ §11.2's stated default `false`). Calling this twice replaces
   * the previous subscription rather than stacking two.
   */
  enableAutoUnloadOnBackground(appLifecycle: AppLifecyclePort, onRelease: () => Promise<void>): void {
    this.backgroundSubscription?.();
    this.backgroundSubscription = appLifecycle.onStateChange((state) => {
      if (!state.isActive) void onRelease();
    });
  }

  /** Reverses {@link enableAutoUnloadOnBackground} — mostly useful for tests; not part of the public `LocalAiClient` surface. */
  disableAutoUnloadOnBackground(): void {
    this.backgroundSubscription?.();
    this.backgroundSubscription = null;
  }
}
