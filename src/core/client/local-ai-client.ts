import type { LocalAiPorts } from '../ports/index.js';
import type { SupportReport } from '../support/types.js';
import type { EligibilityReport } from '../support/types.js';
import type { ManifestDiff } from '../manifest/manifest.diff.js';
import { ManifestService } from '../manifest/manifest.service.js';
import { resolveArtifactUrl } from '../manifest/artifact-url.js';
import { SupportChecker } from '../support/support-checker.js';
import { EligibilityService } from '../support/eligibility-service.js';
import { Database } from '../db/database.js';
import { ConversationStore } from '../conversations/conversation-store.js';
import { RuntimeFacade } from '../runtime/runtime-facade.js';
import { DownloadEngine } from '../download/download-engine.js';
import {
  ConfigInvalidError,
  DeviceNotEligibleError,
  ManifestFetchError,
  PlatformNotSupportedError,
  RuntimeInitError,
} from '../errors.js';
import type { DownloadProgress, DownloadHandle } from '../download/download-state.js';
import type {
  CompletionInput,
  CompletionOptions,
  CompletionResult,
  CompletionStream,
  CompletionToken,
  ContextStrategy,
  LocalAiEventMap,
  Unsubscribe,
} from '../types.js';
import type { Chat, ChatMessage, ConversationApi, ConversationSyncApi } from '../conversations/conversation.types.js';
import type { VectorEntry, VectorSearchHit } from '../db/vector-store.js';
import type { LocalAiManifest } from '../manifest/manifest.schema.js';

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

const REQUIRED_PORT_KEYS: Array<keyof LocalAiPorts> = [
  'platformSupport',
  'deviceInfo',
  'downloadTransport',
  'fileSystem',
  'sqlite',
  'llmRuntime',
  'clock',
  'hash',
  'appLifecycle',
];

function requirePorts(ports: Partial<LocalAiPorts> | undefined): LocalAiPorts {
  const missing = REQUIRED_PORT_KEYS.filter((key) => !ports?.[key]);
  if (missing.length > 0) {
    throw new ConfigInvalidError(
      `LocalAiConfig.ports is missing: ${missing.join(', ')} — core cannot default these itself ` +
        `(hexagonal boundary, CLAUDE.md); assemble a full LocalAiPorts on the consumer side, e.g. via ` +
        `local-ai/adapters/capacitor's exported adapter classes, and pass it as config.ports.`,
    );
  }
  return ports as LocalAiPorts;
}

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  // Intentionally yields nothing — used when a stream never actually starts.
}

function rejectedCompletionStream<T>(error: Error): CompletionStream<T> {
  return { [Symbol.asyncIterator]: () => emptyAsyncIterable<never>()[Symbol.asyncIterator](), result: Promise.reject(error) };
}

/**
 * Single public entry point — TZ §10. `create()`/`checkSupport()`/
 * `checkDeviceEligibility()`/`resetLocalVerdicts()`/`refreshManifest()`/
 * `ensureModelReady()`/`ensureEmbeddingReady()`/`ensureReady()`/`complete()`/
 * `embed()`/`on()`/the Mode-A `ConversationApi` CRUD methods are real
 * (ROADMAP.md Phase 4, plus the CRUD methods pulled forward since
 * `ConversationStore` already existed from Phase 3 — see that phase's
 * status note). `sendMessage()`/`switchModel()`/`switchEmbedding()`/
 * `vectors.*`/`releaseRuntime()`/lifecycle methods remain stubs — Phase
 * 5/6 own those.
 */
export class LocalAiClient implements ConversationApi, ConversationSyncApi {
  private currentManifest: LocalAiManifest | null = null;
  private modelLoaded = false;
  private embeddingLoaded = false;
  private readonly listeners = new Map<keyof LocalAiEventMap, Set<(payload: never) => void>>();

  private constructor(
    private readonly config: LocalAiConfig,
    private readonly ports: LocalAiPorts,
    private readonly manifestService: ManifestService,
    private readonly supportChecker: SupportChecker,
    private readonly eligibilityService: EligibilityService,
    private readonly database: Database,
    private readonly conversationStore: ConversationStore,
    private readonly runtimeFacade: RuntimeFacade,
    private readonly downloadEngine: DownloadEngine,
  ) {}

  /** Creates and initializes a client from config + optional port overrides. TZ §10. */
  static async create(config: LocalAiConfig): Promise<LocalAiClient> {
    const ports = requirePorts(config.ports);

    const database = new Database(ports.sqlite, ports.clock);
    await database.migrate();

    const manifestService = new ManifestService(config.manifestUrl, ports.sqlite, ports.clock, config.maxModelParamsB ?? 4);
    const supportChecker = new SupportChecker(ports.platformSupport);
    const eligibilityService = new EligibilityService(ports.deviceInfo, ports.sqlite, ports.clock);
    const conversationStore = new ConversationStore(ports.sqlite, ports.clock);
    const runtimeFacade = new RuntimeFacade(ports.llmRuntime);
    const downloadEngine = new DownloadEngine(ports.downloadTransport, ports.fileSystem, ports.hash, ports.sqlite, ports.clock);

    const client = new LocalAiClient(
      config,
      ports,
      manifestService,
      supportChecker,
      eligibilityService,
      database,
      conversationStore,
      runtimeFacade,
      downloadEngine,
    );
    client.currentManifest = await manifestService.getCachedManifest();
    return client;
  }

  /**
   * Environment-only check — no `manifestUrl`/network needed. Safe to call
   * before {@link LocalAiClient.create} to decide whether to attempt it at
   * all. TZ §6.1.
   */
  static async checkSupport(ports?: Partial<Pick<LocalAiPorts, 'platformSupport'>>): Promise<SupportReport> {
    if (!ports?.platformSupport) {
      throw new ConfigInvalidError('checkSupport() requires ports.platformSupport');
    }
    return new SupportChecker(ports.platformSupport).check();
  }

  async checkDeviceEligibility(target: 'model' | 'embedding' = 'model'): Promise<EligibilityReport> {
    const manifest = this.currentManifest ?? (await this.manifestService.getCachedManifest());
    if (!manifest) {
      return {
        verdict: 'unknown',
        reasons: ['no manifest available yet — call refreshManifest() first'],
        device: await this.ports.deviceInfo.getSnapshot(),
      };
    }
    const artifact = target === 'embedding' ? manifest.embedding : manifest.model;
    return this.eligibilityService.evaluate({
      id: artifact.id,
      version: artifact.version,
      minRamGb: artifact.minRamGb,
      recommendedRamGb: artifact.recommendedRamGb,
      sizeBytes: artifact.sizeBytes,
    });
  }

  async resetLocalVerdicts(): Promise<void> {
    await this.eligibilityService.resetLocalVerdicts();
  }

  async refreshManifest(): Promise<ManifestDiff> {
    try {
      const { manifest, diff } = await this.manifestService.refresh();
      this.currentManifest = manifest;
      this.emit('manifest:updated', diff);
      return diff;
    } catch (err) {
      // TZ §5.2: manifest not accepted -> keep serving the cached one, emit
      // manifest:invalid instead of throwing past this method.
      this.emit('manifest:invalid', { error: err as Error });
      const cached = await this.manifestService.getCachedManifest();
      if (!cached) throw err; // nothing to fall back to at all — genuinely can't proceed
      this.currentManifest = cached;
      return {
        modelChanged: false,
        embeddingChanged: false,
        model: { to: cached.model },
        embedding: { to: cached.embedding },
      };
    }
  }

  private async ensureSupportOk(): Promise<void> {
    const report = await this.supportChecker.check();
    if (!report.capabilities.inference) {
      throw new PlatformNotSupportedError(`inference is not available on this build: ${report.reasons.join('; ')}`);
    }
  }

  /** TZ §6.4's policy table — `'ignore'` means this verdict is never acted on (no throw, no warn event). */
  private applyEligibilityPolicy(report: EligibilityReport): void {
    const policy = this.config.eligibilityPolicy ?? {};
    if (report.verdict === 'no') {
      const action = policy.no ?? 'block';
      if (action === 'ignore') return;
      if (action === 'block') {
        throw new DeviceNotEligibleError(`device is not eligible: ${report.reasons.join('; ')}`);
      }
      this.emit('device:eligibility-warning', report);
      return;
    }
    if (report.verdict === 'tight' || report.verdict === 'unknown') {
      const action = policy.tight ?? 'warn';
      if (action === 'ignore') return;
      if (action === 'block') {
        throw new DeviceNotEligibleError(`device eligibility is '${report.verdict}': ${report.reasons.join('; ')}`);
      }
      this.emit('device:eligibility-warning', report);
    }
  }

  private async ensureManifestLoaded(): Promise<void> {
    if (this.currentManifest) return;
    await this.refreshManifest();
    if (!this.currentManifest) {
      throw new ManifestFetchError('no manifest available — refreshManifest() did not produce one');
    }
  }

  async ensureModelReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureSupportOk();
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;

    // Always evaluate — applyEligibilityPolicy() is what decides whether a
    // given verdict actually blocks/warns/is ignored (TZ §6.4's policy is
    // per-verdict, not an all-or-nothing skip).
    this.applyEligibilityPolicy(await this.checkDeviceEligibility('model'));

    const artifact = manifest.model;
    const { destinationPath } = await this.downloadEngine.downloadArtifact(
      { kind: 'model', filename: artifact.filename, url: resolveArtifactUrl(artifact), sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      { onProgress: (p) => { options?.onProgress?.(p); this.emit('download:progress', p); } },
    );
    this.emit('download:completed', { key: destinationPath, kind: 'model' });

    if (!this.modelLoaded) {
      await this.ports.llmRuntime.loadModel({ modelPath: destinationPath, contextLength: artifact.contextLength });
      this.modelLoaded = true;
      this.emit('runtime:model-loaded', { modelId: artifact.id, version: artifact.version });
    }
  }

  async ensureEmbeddingReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureSupportOk();
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;

    const report = await this.checkDeviceEligibility('embedding');
    this.applyEligibilityPolicy(report);

    const artifact = manifest.embedding;
    const { destinationPath } = await this.downloadEngine.downloadArtifact(
      { kind: 'embedding', filename: artifact.filename, url: resolveArtifactUrl(artifact), sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      { onProgress: (p) => { options?.onProgress?.(p); this.emit('download:progress', p); } },
    );
    this.emit('download:completed', { key: destinationPath, kind: 'embedding' });

    if (!this.embeddingLoaded) {
      await this.ports.llmRuntime.loadEmbeddingModel({ modelPath: destinationPath });
      this.embeddingLoaded = true;
      this.emit('runtime:embedding-loaded', { embeddingId: artifact.id, version: artifact.version });
    }
  }

  async ensureReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureModelReady(options);
    await this.ensureEmbeddingReady(options);
  }

  /** Safe update ordering per TZ §5.5. */
  async switchModel(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  /** Safe update ordering per TZ §5.6. */
  async switchEmbedding(_options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  complete(input: CompletionInput, signal?: AbortSignal): CompletionStream<CompletionResult> {
    if (!this.modelLoaded || !this.currentManifest) {
      return rejectedCompletionStream(new RuntimeInitError('call ensureModelReady() before complete()'));
    }
    return this.runtimeFacade.complete(input, { chatTemplate: this.currentManifest.model.chatTemplate }, signal);
  }

  async embed(text: string | string[]): Promise<Float32Array | Float32Array[]> {
    if (!this.embeddingLoaded) {
      throw new RuntimeInitError('call ensureEmbeddingReady() before embed()');
    }
    return this.ports.llmRuntime.embed(text);
  }

  // --- ConversationApi (MVP, TZ §9.2) — Mode A ---
  // Pass-through to ConversationStore (Phase 3) — cheap to wire once that
  // class exists, see this class's doc comment.

  async createChat(options?: {
    id?: string;
    title?: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    const chat = await this.conversationStore.createChat(options);
    this.emit('chat:created', { chatId: chat.id });
    return chat;
  }

  async listChats(options?: { limit?: number; offset?: number; orderBy?: 'updatedAt' | 'createdAt' }): Promise<Chat[]> {
    return this.conversationStore.listChats(options);
  }

  async getChat(chatId: string): Promise<Chat | null> {
    return this.conversationStore.getChat(chatId);
  }

  async renameChat(chatId: string, title: string): Promise<void> {
    await this.conversationStore.renameChat(chatId, title);
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.conversationStore.deleteChat(chatId);
    this.emit('chat:deleted', { chatId });
  }

  async getMessages(chatId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    return this.conversationStore.getMessages(chatId, options);
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

  on<E extends keyof LocalAiEventMap>(event: E, handler: (payload: LocalAiEventMap[E]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set!.delete(handler as (payload: never) => void);
  }

  private emit<E extends keyof LocalAiEventMap>(event: E, payload: LocalAiEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) (handler as (payload: LocalAiEventMap[E]) => void)(payload);
  }

  async destroy(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

// Re-exported so callers importing only this module still get the token
// type without a second import from core/types.js.
export type { CompletionToken };
