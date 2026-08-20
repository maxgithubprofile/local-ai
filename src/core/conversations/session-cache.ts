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

function slotKey(chatId: string, modelFingerprint: string): string {
  return `${chatId}::${modelFingerprint}`;
}

/** Default number of session-file slots kept on disk before the LRU evicts — Phase 8, `docs/decisions.md` #8. */
export const DEFAULT_SESSION_CACHE_SLOTS = 3;

/**
 * Orchestrates `LlmRuntimePort`'s `saveSession`/`loadSession` so switching
 * between chats doesn't require replaying the full history as a prompt
 * every time — TZ §9.3. Only one chat's KV state can ever be "hot" in the
 * runtime's own in-process memory at a time (`activeChat`) — that's a
 * hardware fact, not a policy choice. What *is* a policy choice, and what
 * Phase 8 changes, is how many chats' session **files** stay valid on disk
 * for a fast reload the next time they become hot: a bounded LRU of
 * `maxSlots` `(chatId, modelFingerprint)` pairs (`docs/decisions.md` #8),
 * replacing v1's unbounded "every saved file lives forever until
 * `deleteChat`/`switchModel`" behavior. Session files are derived state:
 * on missing/corrupt/incompatible-model-version, {@link SessionCache.activate}
 * reports `loadedFromCache: false` rather than throwing — the caller
 * (`LocalAiClient.sendMessage()`) rebuilds the prompt from SQL history
 * instead. LRU order is tracked in-process only — see the class's
 * `docs/decisions.md` #8 entry for why that's an acceptable v1 limit.
 */
export class SessionCache {
  private activeChatId: string | null = null;
  private activeFingerprint: string | null = null;
  private readonly maxSlots: number;
  /** Insertion order == recency order (`Map` preserves insertion order); oldest entry is `.keys().next()`. */
  private readonly lru = new Map<string, { chatId: string; modelFingerprint: string }>();

  constructor(
    private readonly llmRuntime: LlmRuntimePort,
    private readonly fileSystem: FileSystemPort,
    options?: { maxSlots?: number },
  ) {
    this.maxSlots = options?.maxSlots ?? DEFAULT_SESSION_CACHE_SLOTS;
  }

  private sessionPath(chatId: string, modelFingerprint: string): string {
    return this.fileSystem.resolvePath('sessions', sessionFilename(chatId, modelFingerprint));
  }

  /** Marks `(chatId, modelFingerprint)` as most-recently-used and evicts the oldest slot(s) past `maxSlots`, if any. */
  private async touch(chatId: string, modelFingerprint: string): Promise<void> {
    const key = slotKey(chatId, modelFingerprint);
    this.lru.delete(key); // re-insert below to move it to the "most recent" (end) position
    this.lru.set(key, { chatId, modelFingerprint });

    while (this.lru.size > this.maxSlots) {
      const oldest = this.lru.keys().next();
      if (oldest.done) break;
      const evicted = this.lru.get(oldest.value)!;
      this.lru.delete(oldest.value);
      await this.fileSystem.deleteFile(this.sessionPath(evicted.chatId, evicted.modelFingerprint)).catch(() => undefined);
    }
  }

  /**
   * Makes `chatId` the hot slot. If a session file for `(chatId,
   * modelFingerprint)` exists and loads successfully, the runtime's KV
   * cache now reflects that chat's history — the caller can skip replaying
   * `getMessages(chatId)` as a prompt (TZ §9.3 step 1a). Otherwise (no
   * file, or `loadSession` throws — corrupt/incompatible) the caller must
   * fall back to a cold start (step 1b); this method still updates the hot
   * pointer to `chatId` either way, since callers only care about "should I
   * replay the prompt", not about the underlying failure. A successful
   * cache hit also counts as a touch for LRU purposes.
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
      // loadSession() hands the path straight to the native runtime, which
      // has no concept of this port's relative+directory convention — see
      // FileSystemPort.toAbsolutePath()'s doc comment. `path` itself stays
      // relative for the fileSystem.*() calls above/below, which do
      // understand that convention.
      await this.llmRuntime.loadSession(await this.fileSystem.toAbsolutePath(path));
      await this.touch(chatId, modelFingerprint);
      return { loadedFromCache: true };
    } catch {
      await this.fileSystem.deleteFile(path).catch(() => undefined);
      this.lru.delete(slotKey(chatId, modelFingerprint));
      return { loadedFromCache: false };
    }
  }

  /** Persists the current runtime KV state as `chatId`'s session file — call after a completed generation (TZ §9.3 step 4). Counts as a touch; may evict a different, older slot if this pushes the cache past `maxSlots`. */
  async save(chatId: string, modelFingerprint: string): Promise<void> {
    const path = this.sessionPath(chatId, modelFingerprint);
    await this.llmRuntime.saveSession(await this.fileSystem.toAbsolutePath(path));
    await this.touch(chatId, modelFingerprint);
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
    this.lru.clear();
    this.activeChatId = null;
    this.activeFingerprint = null;
  }

  /** `ConversationStore.deleteChat()`'s SQL-side cascade doesn't reach the filesystem — this is the other half (TZ §9.2). Also used by `updateMessage()`/`deleteMessages()` (Phase 8) to invalidate a chat's now-stale session file without touching any other chat's. */
  async deleteForChat(chatId: string): Promise<void> {
    const dir = this.fileSystem.resolvePath('sessions');
    const files = await this.fileSystem.listFiles(dir).catch(() => [] as string[]);
    const prefix = `session-${chatId}-`;
    for (const file of files) {
      if (file.startsWith(prefix)) {
        await this.fileSystem.deleteFile(this.fileSystem.resolvePath('sessions', file)).catch(() => undefined);
      }
    }
    for (const key of this.lru.keys()) {
      if (key.startsWith(`${chatId}::`)) this.lru.delete(key);
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
   * what makes this pointer stale in the first place). The LRU set of
   * on-disk slots is untouched too — only the single in-process hot pointer.
   */
  resetHotHandle(): void {
    this.activeChatId = null;
    this.activeFingerprint = null;
  }

  /** The chat currently holding the runtime's hot KV state, if any. */
  get activeChat(): string | null {
    return this.activeChatId;
  }

  /** Number of `(chatId, modelFingerprint)` slots this cache will keep on disk before evicting the least-recently-used — Phase 8, `docs/decisions.md` #8. */
  get slotCount(): number {
    return this.maxSlots;
  }
}
