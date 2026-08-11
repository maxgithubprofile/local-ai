import type { LlmRuntimePort } from '../ports/llm-runtime.port.js';
import type { FileSystemPort } from '../ports/filesystem.port.js';

function sessionFilename(chatId: string, modelFingerprint: string): string {
  // Model fingerprint embedded directly in the filename rather than
  // tracked in separate metadata: a fingerprint mismatch then just looks
  // like "no file for this chat" (falls through to the cold-start/rebuild
  // path below) without needing a side table to go stale independently of
  // the file it describes.
  return `session-${chatId}-${modelFingerprint}.bin`;
}

/**
 * Orchestrates `LlmRuntimePort`'s `saveSession`/`loadSession` so switching
 * between chats doesn't require replaying the full history as a prompt
 * every time — TZ §9.3. v1 caches exactly one "hot" (most recently active)
 * chat's session file; a multi-slot LRU is explicitly deferred to Phase 8
 * (TZ §9.3, §16.8). Session files are derived state: on missing/corrupt/
 * incompatible-model-version, {@link SessionCache.activate} reports
 * `loadedFromCache: false` rather than throwing — the caller (`LocalAiClient
 * .sendMessage()`) rebuilds the prompt from SQL history instead.
 */
export class SessionCache {
  private activeChatId: string | null = null;
  private activeFingerprint: string | null = null;

  constructor(
    private readonly llmRuntime: LlmRuntimePort,
    private readonly fileSystem: FileSystemPort,
  ) {}

  private sessionPath(chatId: string, modelFingerprint: string): string {
    return this.fileSystem.resolvePath('sessions', sessionFilename(chatId, modelFingerprint));
  }

  /**
   * Makes `chatId` the hot slot. If a session file for `(chatId,
   * modelFingerprint)` exists and loads successfully, the runtime's KV
   * cache now reflects that chat's history — the caller can skip replaying
   * `getMessages(chatId)` as a prompt (TZ §9.3 step 1a). Otherwise (no
   * file, or `loadSession` throws — corrupt/incompatible) the caller must
   * fall back to a cold start (step 1b); this method still updates the hot
   * pointer to `chatId` either way, since callers only care about "should I
   * replay the prompt", not about the underlying failure.
   */
  async activate(chatId: string, modelFingerprint: string): Promise<{ loadedFromCache: boolean }> {
    if (this.activeChatId === chatId && this.activeFingerprint === modelFingerprint) {
      return { loadedFromCache: true }; // already the hot slot — nothing to do
    }

    const path = this.sessionPath(chatId, modelFingerprint);
    this.activeChatId = chatId;
    this.activeFingerprint = modelFingerprint;

    if (!(await this.fileSystem.exists(path))) {
      return { loadedFromCache: false };
    }
    try {
      await this.llmRuntime.loadSession(path);
      return { loadedFromCache: true };
    } catch {
      await this.fileSystem.deleteFile(path).catch(() => undefined);
      return { loadedFromCache: false };
    }
  }

  /** Persists the current runtime KV state as `chatId`'s session file — call after a completed generation (TZ §9.3 step 4). */
  async save(chatId: string, modelFingerprint: string): Promise<void> {
    await this.llmRuntime.saveSession(this.sessionPath(chatId, modelFingerprint));
  }

  /**
   * TZ §5.5 step 7 — a model switch invalidates every session file (the KV
   * cache format/content is tied to the exact model weights). Since the
   * fingerprint is already embedded in each filename, a stale file would
   * simply never be found again by {@link activate} for the *new*
   * fingerprint — this method exists to actually reclaim the disk space
   * rather than leave orphaned `.bin` files behind.
   */
  async invalidateAll(): Promise<void> {
    const dir = this.fileSystem.resolvePath('sessions');
    const files = await this.fileSystem.listFiles(dir).catch(() => [] as string[]);
    for (const file of files) {
      await this.fileSystem.deleteFile(this.fileSystem.resolvePath('sessions', file)).catch(() => undefined);
    }
    this.activeChatId = null;
    this.activeFingerprint = null;
  }

  /** `ConversationStore.deleteChat()`'s SQL-side cascade doesn't reach the filesystem — this is the other half (TZ §9.2). */
  async deleteForChat(chatId: string): Promise<void> {
    const dir = this.fileSystem.resolvePath('sessions');
    const files = await this.fileSystem.listFiles(dir).catch(() => [] as string[]);
    const prefix = `session-${chatId}-`;
    for (const file of files) {
      if (file.startsWith(prefix)) {
        await this.fileSystem.deleteFile(this.fileSystem.resolvePath('sessions', file)).catch(() => undefined);
      }
    }
    if (this.activeChatId === chatId) {
      this.activeChatId = null;
      this.activeFingerprint = null;
    }
  }

  /**
   * Forgets which chat is hot **without touching any file on disk** — TZ
   * §11.1's `releaseRuntime()` resets "the in-memory hot session-cache
   * handle" specifically, never the session files themselves (those stay
   * exactly as valid as before; the runtime's actual in-process KV state is
   * what `LifecycleManager.releaseRuntime()` already released, which is
   * what makes this pointer stale in the first place).
   */
  resetHotHandle(): void {
    this.activeChatId = null;
    this.activeFingerprint = null;
  }

  /** The chat currently holding the runtime's hot KV state, if any. */
  get activeChat(): string | null {
    return this.activeChatId;
  }
}
