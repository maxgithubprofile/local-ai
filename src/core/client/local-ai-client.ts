import type { LocalAiPorts } from '../ports/index.js';
import type { SupportReport } from '../support/types.js';
import type { EligibilityReport } from '../support/types.js';
import type { ManifestDiff } from '../manifest/manifest.diff.js';
import type { DownloadProgress, DownloadHandle } from '../download/download-state.js';
import type {
  CompletionInput,
  CompletionOptions,
  CompletionResult,
  CompletionStream,
  ContextStrategy,
  LocalAiEventMap,
  Unsubscribe,
} from '../types.js';
import type { Chat, ChatMessage, ConversationApi, ConversationSyncApi } from '../conversations/conversation.types.js';
import type { VectorEntry, VectorSearchHit } from '../db/vector-store.js';

/** Constructor options for {@link LocalAiClient.create} — TZ §10. */
export interface LocalAiConfig {
  manifestUrl: string;
  storageDirectory?: string;
  databaseName?: string;
  maxModelParamsB?: number;
  autoUnloadOnBackground?: boolean;
  /**
   * `'no'` default `'block'`: `ensureReady()` throws `DeviceNotEligibleError`.
   * `'tight'`/`'unknown'` default `'warn'`: emits `device:eligibility-warning`
   * and continues. `'ignore'` skips the check entirely inside `ensureReady()`
   * (manual `checkDeviceEligibility()` remains callable regardless). TZ §6.4.
   */
  eligibilityPolicy?: { no?: 'block' | 'warn' | 'ignore'; tight?: 'block' | 'warn' | 'ignore' };
  /** See TZ §9.7. Default `'truncate-oldest'` — open product question, TZ §16.17. */
  contextStrategy?: ContextStrategy;
  maxContextTokens?: number;
  ports?: Partial<LocalAiPorts>;
  logger?: LocalAiLogger;
}

/** Pluggable no-op-by-default logger — TZ §14 ("без `console.log` в проде библиотеки"). */
export interface LocalAiLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const NOT_IMPLEMENTED = 'not implemented — see ROADMAP.md for the owning phase';

/**
 * Single public entry point — TZ §10. All method bodies are `throw`ing
 * stubs at this stage of the project (ROADMAP.md Phase 1+ fill them in one
 * at a time); the point of scaffolding the full shape now is that the
 * public API surface is typed and importable, and every phase's task is
 * "implement this one method for real" rather than "invent the signature".
 */
export class LocalAiClient implements ConversationApi, ConversationSyncApi {
  private constructor() {
    // Real construction (port wiring, manifest load) is Phase 1+ — see `create()`.
  }

  /** Creates and initializes a client from config + optional port overrides. TZ §10. */
  static async create(_config: LocalAiConfig): Promise<LocalAiClient> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Environment-only check — no `manifestUrl`/network needed. Safe to call
   * before {@link LocalAiClient.create} to decide whether to attempt it at
   * all. TZ §6.1.
   */
  static async checkSupport(_ports?: Partial<Pick<LocalAiPorts, 'platformSupport'>>): Promise<SupportReport> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async checkDeviceEligibility(_target?: 'model' | 'embedding'): Promise<EligibilityReport> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async resetLocalVerdicts(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async refreshManifest(): Promise<ManifestDiff> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async ensureModelReady(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async ensureEmbeddingReady(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async ensureReady(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** Safe update ordering per TZ §5.5. */
  async switchModel(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** Safe update ordering per TZ §5.6. */
  async switchEmbedding(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  complete(_input: CompletionInput, _signal?: AbortSignal): CompletionStream<CompletionResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async embed(_text: string | string[]): Promise<Float32Array | Float32Array[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // --- ConversationApi (MVP, TZ §9.2) — Mode A ---

  async createChat(_options?: {
    id?: string;
    title?: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async listChats(_options?: { limit?: number; offset?: number; orderBy?: 'updatedAt' | 'createdAt' }): Promise<Chat[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getChat(_chatId: string): Promise<Chat | null> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async renameChat(_chatId: string, _title: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async deleteChat(_chatId: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getMessages(_chatId: string, _options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  sendMessage(
    _chatId: string,
    _text: string,
    _options?: {
      userMessageId?: string;
      assistantMessageId?: string;
      completionOptions?: CompletionOptions;
      signal?: AbortSignal;
    },
  ): CompletionStream<ChatMessage> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // --- ConversationSyncApi (optional, TZ §9.2/§9.6) — Mode B ---

  async upsertChat(_chat: {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async appendMessages(
    _chatId: string,
    _messages: Array<{
      id: string;
      role: ChatMessage['role'];
      content: string;
      status?: ChatMessage['status'];
      createdAt: string;
      tokenCount?: number;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<{ inserted: number; skippedExisting: number }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** Thin sugar over `VectorStore` that auto-fills `VectorSpaceDescriptor` from the active embedding. TZ §8.2, §10. */
  readonly vectors = {
    upsert: async (_entry: VectorEntry): Promise<void> => {
      throw new Error(NOT_IMPLEMENTED);
    },
    search: async (_queryEmbedding: Float32Array, _options?: { topK?: number; filter?: Record<string, unknown> }): Promise<VectorSearchHit[]> => {
      throw new Error(NOT_IMPLEMENTED);
    },
    reindex: async (): Promise<void> => {
      throw new Error(NOT_IMPLEMENTED);
    },
    count: async (): Promise<number> => {
      throw new Error(NOT_IMPLEMENTED);
    },
  };

  readonly downloads = {
    get: (_key: string): DownloadHandle | undefined => {
      throw new Error(NOT_IMPLEMENTED);
    },
    list: (): DownloadHandle[] => {
      throw new Error(NOT_IMPLEMENTED);
    },
  };

  /** Releases native runtime contexts + in-memory caches only — see TZ §11.1 for the exact boundary. */
  async releaseRuntime(_options?: { closeDatabase?: boolean }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** @deprecated Use {@link releaseRuntime} — same method, TZ §11.0 explains the rename. */
  async unloadAll(options?: { closeDatabase?: boolean }): Promise<void> {
    return this.releaseRuntime(options);
  }

  async reload(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  on<E extends keyof LocalAiEventMap>(_event: E, _handler: (payload: LocalAiEventMap[E]) => void): Unsubscribe {
    throw new Error(NOT_IMPLEMENTED);
  }

  async destroy(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
