import type { LocalAiPorts, KvCacheQuant } from '../ports/index.js';
import type { SupportReport } from '../support/types.js';
import type { EligibilityReport } from '../support/types.js';
import type { ManifestDiff } from '../manifest/manifest.diff.js';
import { ManifestService } from '../manifest/manifest.service.js';
import { resolveArtifactUrl } from '../manifest/artifact-url.js';
import { SupportChecker } from '../support/support-checker.js';
import { EligibilityService } from '../support/eligibility-service.js';
import { Database } from '../db/database.js';
import { ConversationStore } from '../conversations/conversation-store.js';
import { SessionCache } from '../conversations/session-cache.js';
import { buildContextWindow, defaultMaxContextTokens, estimateTokensHeuristic } from '../conversations/context-window-policy.js';
import { RuntimeFacade } from '../runtime/runtime-facade.js';
import { LifecycleManager } from '../runtime/lifecycle-manager.js';
import { DownloadEngine } from '../download/download-engine.js';
import { ModelRegistry } from '../registry/model-registry.js';
import { LogStore } from '../logging/log-store.js';
import { levelMeetsThreshold } from '../logging/log-levels.js';
import type { LogExportApi } from '../logging/logging.types.js';
import {
  ConfigInvalidError,
  DeviceNotEligibleError,
  ManifestFetchError,
  PlatformNotSupportedError,
  RuntimeInitError,
} from '../errors.js';
import { createMessageSearchIndex } from '../db/create-message-search-index.js';
import type { MessageSearchIndex } from '../db/message-search-index.js';
import type { DownloadProgress, DownloadHandle, PartialDownloadProgress } from '../download/download-state.js';
import type {
  CompletionInput,
  CompletionOptions,
  CompletionResult,
  CompletionStream,
  CompletionToken,
  ContextStrategy,
  LocalAiEventMap,
  LogEntry,
  LogLevel,
  Unsubscribe,
} from '../types.js';
import type {
  Chat,
  ChatExport,
  ChatExportApi,
  ChatMessage,
  ChatSearchApi,
  ChatSearchHit,
  ConversationApi,
  ConversationSyncApi,
} from '../conversations/conversation.types.js';
import type { VectorEntry, VectorSearchHit, VectorSpaceDescriptor, VectorStore } from '../db/vector-store.js';
import { createVectorStore } from '../db/create-vector-store.js';
import type { EmbeddingArtifact, LocalAiManifest, ModelArtifact } from '../manifest/manifest.schema.js';
import { AsyncTokenQueue } from '../utils/async-token-queue.js';

/** Constructor options for {@link LocalAiClient.create} — TZ §10. */
export interface LocalAiConfig {
  manifestUrl: string;
  storageDirectory?: string;
  databaseName?: string;
  maxModelParamsB?: number;
  autoUnloadOnBackground?: boolean;
  /**
   * Default `false` (multi-model plan §2's original "one model on disk at a
   * time" — deliberate for storage-constrained devices): `switchModel()`/
   * `ensureModelReady()`'s internal convergence delete the old model's file
   * once the new one is verified+loaded. Set `true` to keep every
   * downloaded model's file on disk across a switch — lets a consumer offer
   * an instant "switch back" between models the user has already
   * downloaded, at the cost of that much extra storage per resident model
   * (docs/plans/llama2/2026-08-21-multi-model-selection-plan.md's
   * multi-model-resident follow-up, 2026-08-21). Embedding switches are
   * unaffected either way — `switchEmbedding()` always deletes the old
   * embedding file, embeddings aren't part of this trade-off.
   */
  retainInactiveModels?: boolean;
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
  /** Number of chats' session files `SessionCache` keeps on disk (LRU-evicted) — Phase 8, default `3`. See `docs/decisions.md` #8. */
  sessionCacheSlots?: number;
  /**
   * CPU-only native-runtime tuning knobs — all optional, all additive
   * (`undefined` = native default, unchanged behavior for any consumer that
   * doesn't set them). See
   * `docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md` §3
   * (`threads`), §5 (`batchSize`/`ubatchSize`) and §6
   * (`flashAttention`/`kvCacheQuant`) — the latter two are plumbed but
   * deliberately left unset by `forta.chat` until there's a device
   * measurement in isolation, same reasoning as `batchSize`/`ubatchSize`.
   * `kvCacheQuant` set without `flashAttention: true` is silently dropped
   * (warn-logged, not thrown) before ever reaching `LlmRuntimePort.loadModel()`
   * — see `resolveRuntimeTuning()`'s own doc comment for why.
   */
  runtimeTuning?: {
    threads?: number;
    batchSize?: number;
    ubatchSize?: number;
    flashAttention?: boolean;
    kvCacheQuant?: KvCacheQuant;
  };
  /**
   * TZ §6.2's `tooSlow` threshold — `tgAvg < tooSlowTokPerSec` after
   * `LlmRuntimePort.bench()`, recorded as a `LocalRuntimeVerdict` (TZ §6.3)
   * so the *next* {@link checkDeviceEligibility} call downgrades to
   * `'tight'`. Default `3`, per TZ §6.2's own table ("ниже — UX чата
   * неприемлем"). See
   * `docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md` §7 for why
   * this is wired here — `bench()`/`recordVerdict()` already existed but
   * nothing ever called them together.
   */
  tooSlowTokPerSec?: number;
  ports?: Partial<LocalAiPorts>;
  /**
   * Pluggable callback — called for every internal log event regardless of
   * {@link LocalAiConfig.logging}, TZ §14. Independent of `logging`: this
   * fires even when persisted logging is off, and `logging.enabled` doesn't
   * require a `logger` to be set either — see `docs/decisions.md`'s "Local
   * logging & export" entry.
   */
  logger?: LocalAiLogger;
  /**
   * Opt-in **local, persisted** log store (`LogStore`, `logs` table) a host
   * app can read back later via {@link LogExportApi.exportLogs} — e.g. an
   * in-app "export logs" button. Not a TZ §15 phase; see ROADMAP.md's
   * "Local logging & export" section and `docs/decisions.md`'s entry of the
   * same name for why this is opt-in/off by default and why `logger` above
   * doesn't imply this. Default `enabled: false`; when enabled, defaults
   * are `minLevel: 'info'`, `maxEntries: 5000`.
   */
  logging?: { enabled?: boolean; minLevel?: LogLevel; maxEntries?: number };
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
 * `kv_store` key for the persisted user model choice — multi-model plan §6
 * п.1. Deliberately a `LocalAiClient`-level key, not `ManifestService`'s
 * (`manifest:cached`/`manifest:etag`): the selection must survive a
 * manifest refresh untouched, not be tied to whichever manifest happened
 * to be cached when the user picked it.
 */
const KV_KEY_SELECTED_MODEL = 'client:selectedModelId';

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

/** Log level of every `LocalAiEventMap` event, for LOG.3's "hook into emit() so every event logs itself for free" (ROADMAP.md's "Local logging & export" section). */
const EVENT_LOG_LEVEL: { [E in keyof LocalAiEventMap]: LogLevel } = {
  'manifest:updated': 'info',
  'manifest:invalid': 'error',
  'model:selected': 'info',
  'device:eligibility-warning': 'warn',
  'download:progress': 'debug',
  'download:completed': 'info',
  'download:failed': 'error',
  'runtime:model-loaded': 'info',
  'runtime:embedding-loaded': 'info',
  'runtime:unloaded': 'info',
  'vector-store:fallback-active': 'warn',
  'chat-search:fallback-active': 'warn',
  'vector-store:embedding-changed': 'info',
  'chat:created': 'debug',
  'chat:deleted': 'debug',
  'chat:message-appended': 'debug',
};

/**
 * JSON-safe copy of an event payload for `LogStore.append()` — `Error`
 * instances (e.g. `manifest:invalid`'s `{ error }`, `download:failed`'s
 * `{ error }`) serialize to `{}` under plain `JSON.stringify` (their
 * `message`/`name` aren't own-enumerable), so they're unwrapped explicitly
 * here. The raw payload (with the real `Error` object intact) still goes to
 * the pluggable `logger` callback unchanged — this sanitizing only applies
 * to what gets persisted as `meta_json`.
 */
function sanitizeLogMeta(payload: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(payload, (_key, value: unknown) =>
      value instanceof Error ? { name: value.name, message: value.message } : value,
    ),
  ) as Record<string, unknown>;
}

/** Single public entry point — TZ §10. */
export class LocalAiClient implements ConversationApi, ConversationSyncApi, ChatSearchApi, ChatExportApi, LogExportApi {
  private currentManifest: LocalAiManifest | null = null;
  private modelLoaded = false;
  /** The exact model artifact currently loaded in the native runtime — may differ from `resolveSelectedModel()`'s result if `selectModel()` was called without a follow-up `ensureModelReady()`/`switchModel()` yet. `null` whenever `modelLoaded` is `false`. */
  private loadedModelArtifact: ModelArtifact | null = null;
  private embeddingLoaded = false;
  /** Same idea as {@link loadedModelArtifact}, for the embedding side. */
  private loadedEmbeddingArtifact: EmbeddingArtifact | null = null;
  /** In-memory cache of `kv_store`'s `KV_KEY_SELECTED_MODEL`, warmed once in `create()` and kept in sync by `selectModel()` — lets `resolveSelectedModel()`/`activeVectorSpace()` stay synchronous instead of re-querying sqlite on every call. */
  private selectedModelId: string | null = null;
  private vectorStore: VectorStore | null = null;
  private messageSearchIndex: MessageSearchIndex | null = null;
  private readonly listeners = new Map<keyof LocalAiEventMap, Set<(payload: never) => void>>();

  private constructor(
    private readonly config: LocalAiConfig,
    private readonly ports: LocalAiPorts,
    private readonly manifestService: ManifestService,
    private readonly supportChecker: SupportChecker,
    private readonly eligibilityService: EligibilityService,
    private readonly database: Database,
    private readonly conversationStore: ConversationStore,
    private readonly sessionCache: SessionCache,
    private readonly modelRegistry: ModelRegistry,
    private readonly runtimeFacade: RuntimeFacade,
    private readonly downloadEngine: DownloadEngine,
    private readonly lifecycleManager: LifecycleManager,
    private readonly logStore: LogStore,
  ) {}

  /** Creates and initializes a client from config + optional port overrides. TZ §10. */
  static async create(config: LocalAiConfig): Promise<LocalAiClient> {
    // SEC.2 (docs/decisions.md's "Security audit (2026-08-11)" section): the
    // manifest fetch is the actual root of trust the sha256/revision pinning
    // depends on — every other network call the library makes is already
    // https-gated (model download, embedding.source.url), so this one can't
    // be left as the one MITM-able exception.
    if (!config.manifestUrl.startsWith('https://')) {
      throw new ConfigInvalidError(`LocalAiConfig.manifestUrl must be an https:// URL, got: ${config.manifestUrl}`);
    }
    const ports = requirePorts(config.ports);

    const database = new Database(ports.sqlite, ports.clock);
    await database.migrate();

    const manifestService = new ManifestService(config.manifestUrl, ports.sqlite, ports.clock, config.maxModelParamsB ?? 4);
    const supportChecker = new SupportChecker(ports.platformSupport);
    const eligibilityService = new EligibilityService(ports.deviceInfo, ports.sqlite, ports.clock);
    const conversationStore = new ConversationStore(ports.sqlite, ports.clock);
    const sessionCache = new SessionCache(ports.llmRuntime, ports.fileSystem, { maxSlots: config.sessionCacheSlots });
    const modelRegistry = new ModelRegistry(ports.sqlite, ports.clock);
    const runtimeFacade = new RuntimeFacade(ports.llmRuntime);
    const downloadEngine = new DownloadEngine(ports.downloadTransport, ports.fileSystem, ports.hash, ports.sqlite, ports.clock, {
      fastVerify: ports.fastVerify,
    });
    const lifecycleManager = new LifecycleManager(ports.llmRuntime, ports.sqlite);
    // LOG.2/LOG.3 — always constructed (the `logs` table always exists once
    // migrated); the opt-in gate is `config.logging?.enabled` at dispatch
    // time, not at construction.
    const logStore = new LogStore(ports.sqlite, ports.clock, { maxEntries: config.logging?.maxEntries });

    const client = new LocalAiClient(
      config,
      ports,
      manifestService,
      supportChecker,
      eligibilityService,
      database,
      conversationStore,
      sessionCache,
      modelRegistry,
      runtimeFacade,
      downloadEngine,
      lifecycleManager,
      logStore,
    );
    client.currentManifest = await manifestService.getCachedManifest();
    client.selectedModelId = await client.getKv(KV_KEY_SELECTED_MODEL);

    // TZ §8.3 — opportunistic sqlite-vec, brute-force fallback if it doesn't
    // pan out on this device; either way vectors.* below just works.
    const { store, usedFallback } = await createVectorStore(ports.sqlite, ports.clock);
    client.vectorStore = store;
    if (usedFallback) {
      await client.emit('vector-store:fallback-active', { reason: 'sqlite-vec unavailable or failed its self-test on this device' });
    }

    // Phase 8 — same opportunistic pattern as the vector store above.
    const { index, usedFallback: usedSearchFallback } = await createMessageSearchIndex(ports.sqlite);
    client.messageSearchIndex = index;
    if (usedSearchFallback) {
      await client.emit('chat-search:fallback-active', { reason: 'FTS5 unavailable or failed its self-test on this device' });
    }

    // TZ §11.2 — opt-in only, default false; never an eager reload on refocus.
    // A background transition mid-generation must not rip the native context
    // out from under an in-progress `complete()` call — when busy, the
    // release waits for that generation to settle first
    // (RuntimeFacade.waitUntilIdle's own doc comment). The `isBusy` check
    // stays synchronous (no `waitUntilIdle()` await) in the common idle
    // case so this doesn't shift the release by an extra microtask tick
    // versus before this existed.
    if (config.autoUnloadOnBackground) {
      const release = (): Promise<void> => client.doReleaseRuntime(undefined, 'background');
      lifecycleManager.enableAutoUnloadOnBackground(ports.appLifecycle, () =>
        runtimeFacade.isBusy ? runtimeFacade.waitUntilIdle().then(release) : release(),
      );
    }

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

  /**
   * TZ §6.4 — evaluates `target` against the current device snapshot plus
   * any locally-cached `LocalRuntimeVerdict`. Resolves `verdict: 'unknown'`
   * (never throws) if no manifest is cached yet, or if `modelId` doesn't
   * name a model in it.
   * @param target Which artifact kind to evaluate — defaults to `'model'`.
   * @param modelId Which model to check — defaults to the resolved
   *   selected model (multi-model plan §7). Always a *model* id, even for
   *   `target: 'embedding'` — resolves that model's compatible embedding
   *   via `compatibleModelIds` rather than taking an embedding id
   *   directly, so a model-picker UI can badge "won't fit" per model
   *   without the caller needing to know embedding ids at all. Passing an
   *   explicit id never mutates `selectedModelId` — a readonly check, e.g.
   *   for a model the user hasn't chosen yet.
   */
  async checkDeviceEligibility(target: 'model' | 'embedding' = 'model', modelId?: string): Promise<EligibilityReport> {
    const manifest = this.currentManifest ?? (await this.manifestService.getCachedManifest());
    if (!manifest) {
      return {
        verdict: 'unknown',
        reasons: ['no manifest available yet — call refreshManifest() first'],
        device: await this.ports.deviceInfo.getSnapshot(),
      };
    }

    let artifact: { id: string; version: number; minRamGb: number; recommendedRamGb: number; sizeBytes: number };
    if (target === 'embedding') {
      const resolvedModelId = modelId ?? this.resolveSelectedModel(manifest).id;
      const embedding = manifest.embeddings.find((e) => e.status === 'active' && e.compatibleModelIds.includes(resolvedModelId));
      if (!embedding) {
        return {
          verdict: 'unknown',
          reasons: [`no active embedding is compatible with model "${resolvedModelId}"`],
          device: await this.ports.deviceInfo.getSnapshot(),
        };
      }
      artifact = embedding;
    } else if (modelId) {
      const found = manifest.models.find((m) => m.id === modelId);
      if (!found) {
        return {
          verdict: 'unknown',
          reasons: [`model "${modelId}" not found in the current manifest`],
          device: await this.ports.deviceInfo.getSnapshot(),
        };
      }
      artifact = found;
    } else {
      artifact = this.resolveSelectedModel(manifest);
    }

    return this.eligibilityService.evaluate({
      id: artifact.id,
      version: artifact.version,
      minRamGb: artifact.minRamGb,
      recommendedRamGb: artifact.recommendedRamGb,
      sizeBytes: artifact.sizeBytes,
    });
  }

  /**
   * Records the user's model choice (multi-model plan §6 п.2). Validates
   * `modelId` against the current manifest (must exist and be
   * `status: 'active'`), persists it to `kv_store` (independent of the
   * manifest's own cache — a manifest refresh doesn't reset which model
   * the user picked), and emits `model:selected`. Deliberately does
   * **not** download or load anything itself — symmetric with
   * `refreshManifest()` not auto-starting a download (TZ §5.4). Call
   * `ensureModelReady()`/`switchModel()` afterward to actually apply it;
   * both converge to whatever `selectedModelId` now is.
   */
  async selectModel(modelId: string): Promise<void> {
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;
    const model = manifest.models.find((m) => m.id === modelId);
    if (!model || model.status !== 'active') {
      throw new ConfigInvalidError(`selectModel(): "${modelId}" is not an active model in the current manifest`);
    }
    await this.setKv(KV_KEY_SELECTED_MODEL, modelId);
    this.selectedModelId = modelId;
    await this.emit('model:selected', { modelId });
  }

  /**
   * The persisted user model choice, or `null` if none was ever made —
   * `resolveSelectedModel()`'s fallback (`recommended`, else first
   * `status: 'active'`) is what actually runs the device in that case, not
   * this getter.
   */
  getSelectedModelId(): string | null {
    return this.selectedModelId;
  }

  /**
   * Resolves which `ModelArtifact` is "the selected one" right now — the
   * persisted choice if it still names an active model in `manifest`,
   * otherwise the manifest's `recommended: true` model, otherwise the
   * first `status: 'active'` model (multi-model plan §6 п.1/п.3). Never
   * silently crashes on a stale/removed selection (e.g. the previously
   * chosen model was deprecated upstream) — always falls back instead.
   * Synchronous: relies on {@link selectedModelId}'s in-memory cache
   * rather than re-reading `kv_store`.
   */
  private resolveSelectedModel(manifest: LocalAiManifest): ModelArtifact {
    const bySelection = this.selectedModelId
      ? manifest.models.find((m) => m.id === this.selectedModelId && m.status === 'active')
      : undefined;
    if (bySelection) return bySelection;
    const recommended = manifest.models.find((m) => m.recommended === true && m.status === 'active');
    const fallback = recommended ?? manifest.models.find((m) => m.status === 'active');
    if (!fallback) {
      throw new ConfigInvalidError('manifest.models has no active model to select from');
    }
    return fallback;
  }

  /**
   * Resolves `modelId`'s compatible embedding — `manifest.embeddings.find`
   * on `compatibleModelIds`, TZ §5.1's "one embedding can serve several
   * models" design (multi-model plan §1/§6 п.5). Throws if none exists;
   * `validateManifest()`'s cross-check (Phase 2) guarantees this can't
   * happen for an active model in a manifest that passed validation, so
   * reaching this only from a genuinely broken manifest is the intended
   * failure mode here (unlike `checkDeviceEligibility()`'s "never throws"
   * contract, which inlines the same lookup non-throwing).
   */
  private resolveEmbeddingForModel(manifest: LocalAiManifest, modelId: string): EmbeddingArtifact {
    const embedding = manifest.embeddings.find((e) => e.status === 'active' && e.compatibleModelIds.includes(modelId));
    if (!embedding) {
      throw new ConfigInvalidError(`no active embedding declares compatibleModelIds including model "${modelId}"`);
    }
    return embedding;
  }

  private isSameModel(artifact: ModelArtifact): boolean {
    return this.loadedModelArtifact?.id === artifact.id && this.loadedModelArtifact?.version === artifact.version;
  }

  private isSameEmbedding(artifact: EmbeddingArtifact): boolean {
    return this.loadedEmbeddingArtifact?.id === artifact.id && this.loadedEmbeddingArtifact?.version === artifact.version;
  }

  private async getKv(key: string): Promise<string | null> {
    const rows = await this.ports.sqlite.query<{ value: string }>('SELECT value FROM kv_store WHERE key = ?', [key]);
    return rows[0]?.value ?? null;
  }

  private async setKv(key: string, value: string): Promise<void> {
    await this.ports.sqlite.execute(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, this.ports.clock.nowIso()],
    );
  }

  /**
   * Reads how much of `target` is already on disk, without starting or
   * resuming the download — for a consumer that wants to show "resume from
   * X%" before the user taps download, rather than only finding out once
   * `ensureModelReady()` is already moving (its own `onProgress` has no way
   * to report a starting-point ahead of the first real network chunk). With
   * `config.retainInactiveModels` this also doubles as "is this specific
   * *inactive* model already fully downloaded" (percent === 100), letting a
   * model-picker UI distinguish "switch" (already resident, fast) from
   * "download" (multi-model plan's follow-up, 2026-08-21) for a model that
   * isn't the current selection. Resolves `null` if there's no cached
   * manifest yet (nothing to size the percentage against), `modelId` isn't
   * a model in it, or no partial file at all — a fresh device and a
   * fully-downloaded device look the same here; check `LocalAiClient`'s own
   * readiness state (or `percent === 100`) to tell those apart.
   * @param target Which artifact to check — defaults to `'model'`.
   * @param modelId `target: 'model'` only — which model to check; defaults
   *   to the resolved selected model. Ignored for `target: 'embedding'`
   *   (always checks the selected model's compatible embedding — embeddings
   *   aren't independently selectable).
   */
  async getDownloadProgress(target: 'model' | 'embedding' = 'model', modelId?: string): Promise<PartialDownloadProgress | null> {
    const manifest = this.currentManifest ?? (await this.manifestService.getCachedManifest());
    if (!manifest) return null;
    let artifact: { filename: string; sizeBytes: number };
    if (target === 'embedding') {
      artifact = this.resolveEmbeddingForModel(manifest, this.resolveSelectedModel(manifest).id);
    } else if (modelId) {
      const found = manifest.models.find((m) => m.id === modelId);
      if (!found) return null;
      artifact = found;
    } else {
      artifact = this.resolveSelectedModel(manifest);
    }
    const path = this.ports.fileSystem.resolvePath(target === 'embedding' ? 'embeddings' : 'models', artifact.filename);
    const stat = await this.ports.fileSystem.stat(path);
    if (!stat || stat.sizeBytes <= 0) return null;
    return {
      bytesDownloaded: stat.sizeBytes,
      sizeBytesExpected: artifact.sizeBytes,
      percent: Math.min(100, Math.round((stat.sizeBytes / artifact.sizeBytes) * 100)),
    };
  }

  /**
   * Pauses the model download if one is currently running — the partial
   * file stays on disk at whatever byte offset it reached; a caller
   * awaiting `ensureModelReady()`/`downloadModel()` for it simply stops
   * progressing until `resumeModelDownload()` is called (or the process
   * restarts and `ensureModelReady()` runs again). No-op if nothing is
   * downloading right now, or no manifest is cached yet.
   */
  async pauseModelDownload(): Promise<void> {
    const manifest = this.currentManifest ?? (await this.manifestService.getCachedManifest());
    if (!manifest) return;
    const artifact = this.resolveSelectedModel(manifest);
    await this.downloadEngine.pause(this.downloadEngine.keyFor(resolveArtifactUrl(artifact), artifact.filename));
  }

  /**
   * Resumes a model download paused via `pauseModelDownload()`, continuing
   * from wherever it left off (real byte-offset resume — see
   * `CapacitorRangeDownloadAdapter`). No-op if nothing is paused, or no
   * manifest is cached yet.
   */
  async resumeModelDownload(): Promise<void> {
    const manifest = this.currentManifest ?? (await this.manifestService.getCachedManifest());
    if (!manifest) return;
    const artifact = this.resolveSelectedModel(manifest);
    await this.downloadEngine.resume(this.downloadEngine.keyFor(resolveArtifactUrl(artifact), artifact.filename));
  }

  /**
   * Deletes a model entirely: stops any in-flight/paused transfer, deletes
   * the (partial or complete) file on disk, clears its persisted
   * `download_state` row, and — only if `modelId` names whichever model is
   * actually loaded right now (or no `modelId` is given at all, matching
   * this method's original single-model contract) — releases the LLM
   * context and demotes the registry's "current" model row. Deleting a
   * *different*, merely-resident model (multi-model plan's
   * `retainInactiveModels` follow-up, 2026-08-21) never touches the
   * runtime — it isn't loaded, there's nothing to release. Leaves the
   * manifest/eligibility state untouched — a later `ensureModelReady()`/
   * `selectModel()` call for the same id downloads it again from scratch,
   * same as a fresh device. Safe to call with nothing downloaded (no-op
   * beyond the already-idempotent runtime/registry cleanup).
   * @param modelId Which model to delete — defaults to the resolved
   *   selected model (backward-compatible with the original no-arg
   *   contract). Must still be present in the current manifest; deleting a
   *   file left behind by a since-removed/deprecated model isn't supported.
   */
  async deleteModel(modelId?: string): Promise<void> {
    const manifest = this.currentManifest ?? (await this.manifestService.getCachedManifest());
    const artifact = modelId
      ? manifest?.models.find((m) => m.id === modelId)
      : manifest
        ? this.resolveSelectedModel(manifest)
        : undefined;
    if (artifact) {
      const key = this.downloadEngine.keyFor(resolveArtifactUrl(artifact), artifact.filename);
      const destinationPath = this.ports.fileSystem.resolvePath('models', artifact.filename);
      await this.downloadEngine.cancel(key, destinationPath, { discardPartial: true });
    }
    // No modelId at all -> original contract: release/demote whatever's
    // current unconditionally. A modelId given -> only if it's the
    // registry's *current* model (durable truth, not just this session's
    // in-memory loadedModelArtifact — a model can be fully on disk and
    // registered as current from a previous session before this one ever
    // calls ensureModelReady()) — deleting a different, merely-resident
    // model must not tear down a still-valid current-model record.
    const currentRegistryRow = await this.modelRegistry.getCurrent('model');
    const deletingCurrentModel = !modelId || currentRegistryRow?.id === modelId;
    if (deletingCurrentModel) {
      if (this.modelLoaded) {
        await this.ports.llmRuntime.releaseModel();
        this.modelLoaded = false;
        this.loadedModelArtifact = null;
        await this.emit('runtime:unloaded', { reason: 'model-deleted' });
      }
      await this.modelRegistry.clearCurrent('model');
    }
  }

  /** TZ §6.3 — clears every locally-cached `LocalRuntimeVerdict` (`'tooSlow'`/`'oom'`), e.g. after the user frees device memory. */
  async resetLocalVerdicts(): Promise<void> {
    await this.eligibilityService.resetLocalVerdicts();
  }

  /**
   * Fetches, validates, and caches the manifest at `manifestUrl`
   * (`If-None-Match`, TZ §5.3); emits `manifest:updated` on a genuine
   * change or `manifest:invalid` on a validation failure — either way this
   * method itself never throws unless there's no cached manifest at all to
   * fall back to (TZ §5.2).
   */
  async refreshManifest(): Promise<ManifestDiff> {
    try {
      const { manifest, diff } = await this.manifestService.refresh();
      this.currentManifest = manifest;
      await this.emit('manifest:updated', diff);
      return diff;
    } catch (err) {
      // TZ §5.2: manifest not accepted -> keep serving the cached one, emit
      // manifest:invalid instead of throwing past this method.
      await this.emit('manifest:invalid', { error: err as Error });
      const cached = await this.manifestService.getCachedManifest();
      if (!cached) throw err; // nothing to fall back to at all — genuinely can't proceed
      this.currentManifest = cached;
      return {
        modelChanged: false,
        embeddingChanged: false,
        models: cached.models.map((m) => ({ id: m.id, from: m, to: m, changed: false })),
        embeddings: cached.embeddings.map((e) => ({ id: e.id, from: e, to: e, changed: false })),
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
  private async applyEligibilityPolicy(report: EligibilityReport): Promise<void> {
    const policy = this.config.eligibilityPolicy ?? {};
    if (report.verdict === 'no') {
      const action = policy.no ?? 'block';
      if (action === 'ignore') return;
      if (action === 'block') {
        const message = `device is not eligible: ${report.reasons.join('; ')}`;
        await this.dispatchLog('error', message); // blocked — no LocalAiEventMap event fires on this path, unlike the warn branch below
        throw new DeviceNotEligibleError(message);
      }
      await this.emit('device:eligibility-warning', report);
      return;
    }
    if (report.verdict === 'tight' || report.verdict === 'unknown') {
      const action = policy.tight ?? 'warn';
      if (action === 'ignore') return;
      if (action === 'block') {
        const message = `device eligibility is '${report.verdict}': ${report.reasons.join('; ')}`;
        await this.dispatchLog('error', message);
        throw new DeviceNotEligibleError(message);
      }
      await this.emit('device:eligibility-warning', report);
    }
  }

  /**
   * perf-tuning plan §6's guard, shared by both `loadModel()` call sites
   * below: `cache_type_k`/`cache_type_v` (KV-cache quantization) is
   * historically unstable/unsupported in llama.cpp for some type
   * combinations when `flash_attn` isn't also on — rather than validating
   * this deep inside the adapter (which has no logger and no config to
   * check against), resolve the safe pair once here, right before either
   * `loadModel()` call. `kvCacheQuant` set without `flashAttention: true` is
   * dropped (warn-logged, never thrown) — `ensureModelReady()`/`switchModel()`
   * must not fail to load a model over a bad tuning knob; degrading to "just
   * don't quantize the cache" is safer than refusing to load at all, same
   * philosophy as this class's other best-effort tuning fallbacks.
   */
  private async resolveRuntimeTuning(): Promise<{
    threads?: number;
    batchSize?: number;
    ubatchSize?: number;
    flashAttention?: boolean;
    kvCacheQuant?: KvCacheQuant;
  }> {
    const tuning = this.config.runtimeTuning ?? {};
    if (tuning.kvCacheQuant !== undefined && !tuning.flashAttention) {
      await this.dispatchLog(
        'warn',
        `runtimeTuning.kvCacheQuant ('${tuning.kvCacheQuant}') requires runtimeTuning.flashAttention: true — ignoring kvCacheQuant, native cache-type default stays in effect`,
      );
      return { ...tuning, kvCacheQuant: undefined };
    }
    return tuning;
  }

  /**
   * Shared wrapper around `DownloadEngine.downloadArtifact()` for every
   * call site below — emits `download:completed` on success or
   * `download:failed` on failure (previously declared in `LocalAiEventMap`
   * but never actually emitted anywhere, LOG.3's "finding this section also
   * fixes"), then rethrows so each caller's own control flow is unchanged.
   * `download:failed` logs itself for free via `emit()`'s `EVENT_LOG_LEVEL`
   * hook — no separate `dispatchLog()` call needed here.
   */
  private async downloadArtifactLogged(
    kind: 'model' | 'embedding',
    spec: { filename: string; url: string; sha256: string; sizeBytes: number },
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<{ destinationPath: string }> {
    try {
      const result = await this.downloadEngine.downloadArtifact(
        { kind, filename: spec.filename, url: spec.url, sha256: spec.sha256, sizeBytes: spec.sizeBytes },
        {
          onProgress: (p) => {
            onProgress?.(p);
            // Fire-and-forget, deliberately not awaited: this callback is a
            // sync (void-returning) port contract (DownloadTransportPort's
            // onProgress). Safe only because emit() never touches LogStore
            // for 'download:progress' (see emit()'s doc comment) — no
            // sqlite transaction is ever opened by this call, so there's
            // nothing for it to race with.
            void this.emit('download:progress', p);
          },
        },
      );
      await this.emit('download:completed', { key: result.destinationPath, kind });
      return result;
    } catch (err) {
      await this.emit('download:failed', { key: spec.filename, kind, error: err as Error });
      throw err;
    }
  }

  private async ensureManifestLoaded(): Promise<void> {
    if (this.currentManifest) return;
    await this.refreshManifest();
    if (!this.currentManifest) {
      throw new ManifestFetchError('no manifest available — refreshManifest() did not produce one');
    }
  }

  /**
   * TZ §5.5/§6.4: support check → eligibility gate → download + sha256
   * verify (resumable, short-circuits if already downloaded) → load into
   * the native runtime. Safe to call repeatedly — a true no-op (no
   * download check, no runtime call) once the *currently selected* model
   * is already loaded.
   *
   * Multi-model plan §6 п.2/п.4: targets `resolveSelectedModel()`, not a
   * fixed manifest field. If a *different* model is already loaded (the
   * caller ran `selectModel()` without a follow-up `switchModel()`), this
   * performs the same release-old/download-new/delete-old-file/invalidate
   * sequence as `switchModel()` — both methods are documented as valid
   * ways to apply a selection, so both must converge to it.
   * @param options.onProgress Called with download progress while the artifact is being fetched.
   */
  async ensureModelReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureSupportOk();
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;
    const artifact = this.resolveSelectedModel(manifest);

    // Always evaluate — applyEligibilityPolicy() is what decides whether a
    // given verdict actually blocks/warns/is ignored (TZ §6.4's policy is
    // per-verdict, not an all-or-nothing skip).
    await this.applyEligibilityPolicy(await this.checkDeviceEligibility('model', artifact.id));

    if (this.modelLoaded && !this.isSameModel(artifact)) {
      await this.performModelSwitch(artifact, options);
      return;
    }

    const { destinationPath } = await this.downloadArtifactLogged(
      'model',
      { filename: artifact.filename, url: resolveArtifactUrl(artifact), sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      options?.onProgress,
    );

    if (!this.modelLoaded) {
      // See DownloadProgress's own doc comment on 'loading' — the download+
      // verify pipeline is already done (status: 'completed') by this
      // point; this is a distinct, separately-visible phase so a UI doesn't
      // read "still stuck at 100%, nothing happening" while a multi-GB GGUF
      // is being parsed/mapped into the runtime.
      options?.onProgress?.({ key: artifact.filename, kind: 'model', percent: 100, status: 'loading' });
      // toAbsolutePath(): destinationPath is relative to this port's own
      // storage convention (Directory.Data on Android) — the native
      // llama.cpp binding behind loadModel() has no concept of that and
      // needs a genuine absolute path (see FileSystemPort.toAbsolutePath()'s
      // doc comment).
      const absoluteModelPath = await this.ports.fileSystem.toAbsolutePath(destinationPath);
      const tuning = await this.resolveRuntimeTuning();
      await this.ports.llmRuntime.loadModel({
        modelPath: absoluteModelPath,
        contextLength: artifact.contextLength,
        threads: tuning.threads,
        batchSize: tuning.batchSize,
        ubatchSize: tuning.ubatchSize,
        flashAttention: tuning.flashAttention,
        kvCacheQuant: tuning.kvCacheQuant,
      });
      this.modelLoaded = true;
      this.loadedModelArtifact = artifact;
      // Registers this as "current" even on a completely fresh install (no
      // prior row) — switchModel() needs an accurate baseline to compute
      // "previous" against on its very first call, not just after a switch.
      // Deliberately doesn't act on `previous` here the way
      // performModelSwitch() does: this branch only runs when nothing was
      // loaded in *this* process, which on an ordinary app restart is the
      // same model/version as before (no stale file, no session-cache
      // invalidation needed) — see performModelSwitch()'s doc comment for
      // the branch that actually changes models.
      await this.modelRegistry.setCurrent('model', {
        id: artifact.id,
        version: artifact.version,
        filename: artifact.filename,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      });
      await this.emit('runtime:model-loaded', { modelId: artifact.id, version: artifact.version });
      // TZ §6.3's tooSlow producer (perf-tuning plan §7) — best-effort,
      // deliberately not awaited: ensureModelReady() must not block on an
      // extra real-inference bench() run on top of an already potentially
      // slow model load. The verdict this writes is for the *next*
      // checkDeviceEligibility() call, not this one, so there's nothing for
      // the caller of ensureModelReady() to wait for.
      if (this.ports.llmRuntime.bench) {
        void this.ports.llmRuntime
          .bench()
          .then((r) => {
            if (r.tgAvg < (this.config.tooSlowTokPerSec ?? 3)) {
              return this.eligibilityService.recordVerdict(artifact.id, artifact.version, 'tooSlow');
            }
          })
          .catch(() => undefined); // best-effort — bench() failing must never surface as ensureModelReady() failing
      }
    }
  }

  /**
   * Same flow as {@link ensureModelReady}, independently, for whichever
   * embedding {@link resolveEmbeddingForModel} resolves for the selected
   * model (TZ §5.6/§6.4, multi-model plan §6 п.5).
   * @param options.onProgress Called with download progress while the artifact is being fetched.
   */
  async ensureEmbeddingReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureSupportOk();
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;
    const selectedModel = this.resolveSelectedModel(manifest);
    const artifact = this.resolveEmbeddingForModel(manifest, selectedModel.id);

    const report = await this.checkDeviceEligibility('embedding', selectedModel.id);
    await this.applyEligibilityPolicy(report);

    if (this.embeddingLoaded && !this.isSameEmbedding(artifact)) {
      await this.performEmbeddingSwitch(artifact, options);
      return;
    }

    const { destinationPath } = await this.downloadArtifactLogged(
      'embedding',
      { filename: artifact.filename, url: resolveArtifactUrl(artifact), sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      options?.onProgress,
    );

    if (!this.embeddingLoaded) {
      options?.onProgress?.({ key: artifact.filename, kind: 'embedding', percent: 100, status: 'loading' });
      const absoluteModelPath = await this.ports.fileSystem.toAbsolutePath(destinationPath);
      await this.ports.llmRuntime.loadEmbeddingModel({ modelPath: absoluteModelPath });
      this.embeddingLoaded = true;
      this.loadedEmbeddingArtifact = artifact;
      await this.modelRegistry.setCurrent('embedding', {
        id: artifact.id,
        version: artifact.version,
        filename: artifact.filename,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        dimensions: artifact.dimensions,
      });
      await this.emit('runtime:embedding-loaded', { embeddingId: artifact.id, version: artifact.version });
    }
  }

  /** `ensureModelReady()` + `ensureEmbeddingReady()`, in order. */
  async ensureReady(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureModelReady(options);
    await this.ensureEmbeddingReady(options);
  }

  /**
   * Safe update ordering per TZ §5.5, shared by `switchModel()`'s
   * unconditional refresh and `ensureModelReady()`'s "a different model is
   * live than the one selected" branch (multi-model plan §6 п.4): download
   * + verify → release the LLM context only → register as current →
   * delete the old model file → invalidate every session-cache file
   * (their KV content is tied to the exact old weights) → reload.
   */
  private async performModelSwitch(artifact: ModelArtifact, options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    // steps 1-2 — DownloadEngine verifies sha256 itself before resolving
    const { destinationPath } = await this.downloadArtifactLogged(
      'model',
      { filename: artifact.filename, url: resolveArtifactUrl(artifact), sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      options?.onProgress,
    );

    await this.ports.llmRuntime.releaseModel(); // step 3 — LLM context only, embedding context untouched
    this.modelLoaded = false;
    this.loadedModelArtifact = null;
    await this.emit('runtime:unloaded', { reason: 'model-switch' });

    const { previous } = await this.modelRegistry.setCurrent('model', {
      id: artifact.id,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    }); // step 4

    // step 5 — old file, never the one we just downloaded. Skipped when
    // config.retainInactiveModels keeps every downloaded model resident
    // (multi-model plan's follow-up, 2026-08-21) — the old model stays on
    // disk so switching back to it later needs no re-download.
    if (!this.config.retainInactiveModels && previous && previous.filename !== artifact.filename) {
      await this.ports.fileSystem.deleteFile(this.ports.fileSystem.resolvePath('models', previous.filename)).catch(() => undefined);
    }

    await this.sessionCache.invalidateAll(); // step 6

    options?.onProgress?.({ key: artifact.filename, kind: 'model', percent: 100, status: 'loading' });
    const absoluteModelPath = await this.ports.fileSystem.toAbsolutePath(destinationPath);
    const tuning = await this.resolveRuntimeTuning();
    await this.ports.llmRuntime.loadModel({
      modelPath: absoluteModelPath,
      contextLength: artifact.contextLength,
      threads: tuning.threads,
      batchSize: tuning.batchSize,
      ubatchSize: tuning.ubatchSize,
      flashAttention: tuning.flashAttention,
      kvCacheQuant: tuning.kvCacheQuant,
    });
    this.modelLoaded = true;
    this.loadedModelArtifact = artifact;
    await this.emit('runtime:model-loaded', { modelId: artifact.id, version: artifact.version });
  }

  /**
   * Unconditionally re-runs {@link performModelSwitch} for whichever model
   * `resolveSelectedModel()` currently resolves to (TZ §5.5, multi-model
   * plan §6 п.4) — used e.g. right after `selectModel()`, or after
   * `refreshManifest()` reports a version bump for the selected model.
   * Unlike `ensureModelReady()`, this never short-circuits even if the
   * resolved target happens to already be loaded — call it when you
   * specifically want the update sequence to run, not just "make sure
   * something usable is loaded".
   */
  async switchModel(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureSupportOk();
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;
    const artifact = this.resolveSelectedModel(manifest);

    await this.applyEligibilityPolicy(await this.checkDeviceEligibility('model', artifact.id));
    await this.performModelSwitch(artifact, options);
  }

  /**
   * Safe update ordering per TZ §5.6 — independent of
   * {@link performModelSwitch}: eligibility gate → download + verify →
   * release the embedding context only → register as current → delete the
   * old embedding file → emit `vector-store:embedding-changed` (never
   * auto-reindexes existing vectors — `VectorStore`'s space guard, TZ
   * §8.2/§8.3, is what actually blocks stale reads/writes until an
   * explicit `vectors.reindex()`) → reload. Shared by `switchEmbedding()`'s
   * unconditional refresh and `ensureEmbeddingReady()`'s "different
   * embedding is live" branch, same pairing as the model side.
   */
  private async performEmbeddingSwitch(artifact: EmbeddingArtifact, options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    const { destinationPath } = await this.downloadArtifactLogged(
      'embedding',
      { filename: artifact.filename, url: resolveArtifactUrl(artifact), sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
      options?.onProgress,
    );

    const previousArtifact = await this.modelRegistry.getCurrent('embedding');

    await this.ports.llmRuntime.releaseEmbeddingModel();
    this.embeddingLoaded = false;
    this.loadedEmbeddingArtifact = null;
    await this.emit('runtime:unloaded', { reason: 'embedding-switch' });

    const { previous } = await this.modelRegistry.setCurrent('embedding', {
      id: artifact.id,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      dimensions: artifact.dimensions,
    });

    if (previous && previous.filename !== artifact.filename) {
      await this.ports.fileSystem.deleteFile(this.ports.fileSystem.resolvePath('embeddings', previous.filename)).catch(() => undefined);
    }

    await this.emit('vector-store:embedding-changed', {
      previous: previousArtifact
        ? { id: previousArtifact.id, version: previousArtifact.version, dimensions: previousArtifact.dimensions ?? 0 }
        : undefined,
      current: { id: artifact.id, version: artifact.version, dimensions: artifact.dimensions },
      dimensionsChanged: previousArtifact ? previousArtifact.dimensions !== artifact.dimensions : true,
    });

    options?.onProgress?.({ key: artifact.filename, kind: 'embedding', percent: 100, status: 'loading' });
    const absoluteModelPath = await this.ports.fileSystem.toAbsolutePath(destinationPath);
    await this.ports.llmRuntime.loadEmbeddingModel({ modelPath: absoluteModelPath });
    this.embeddingLoaded = true;
    this.loadedEmbeddingArtifact = artifact;
    await this.emit('runtime:embedding-loaded', { embeddingId: artifact.id, version: artifact.version });
  }

  /** Unconditional counterpart to {@link switchModel}, for the embedding resolved from the selected model — see {@link performEmbeddingSwitch}. */
  async switchEmbedding(options?: { onProgress?: (p: DownloadProgress) => void }): Promise<void> {
    await this.ensureSupportOk();
    await this.ensureManifestLoaded();
    const manifest = this.currentManifest!;
    const selectedModel = this.resolveSelectedModel(manifest);
    const artifact = this.resolveEmbeddingForModel(manifest, selectedModel.id);

    await this.applyEligibilityPolicy(await this.checkDeviceEligibility('embedding', selectedModel.id));
    await this.performEmbeddingSwitch(artifact, options);
  }

  /**
   * Stateless completion — no chat/session involvement, just `input.messages`
   * in, tokens streamed out (TZ §10.0). `result` rejects with
   * `RuntimeInitError` if `ensureModelReady()` hasn't been called yet, or
   * with `RuntimeBusyError` if another generation is already in flight
   * (TZ §9.4) — the async-iterable side yields nothing in either case.
   * @param input Structured chat messages + sampling options — never a raw prompt string (TZ §4.1).
   * @param signal Optional `AbortSignal` to cancel mid-generation.
   */
  complete(input: CompletionInput, signal?: AbortSignal): CompletionStream<CompletionResult> {
    if (!this.modelLoaded || !this.currentManifest || !this.loadedModelArtifact) {
      const message = 'call ensureModelReady() before complete()';
      this.config.logger?.error(message); // complete() must return CompletionStream synchronously — can't await dispatchLog()'s LogStore write here, so this bypasses the persisted store (logger callback only)
      return rejectedCompletionStream(new RuntimeInitError(message));
    }
    // The actually-loaded model's template, not resolveSelectedModel()'s —
    // selectedModelId can change without a follow-up switch (multi-model
    // plan §12.4); complete() must reflect what's really in the runtime.
    return this.runtimeFacade.complete(input, { chatTemplate: this.loadedModelArtifact.chatTemplate }, signal);
  }

  /**
   * Embeds `text` using the currently loaded embedding model.
   * @param text A single string, or a batch of strings (embedded sequentially — the underlying runtime has no native batch API).
   * @throws {RuntimeInitError} If `ensureEmbeddingReady()` hasn't been called yet.
   */
  async embed(text: string | string[]): Promise<Float32Array | Float32Array[]> {
    if (!this.embeddingLoaded) {
      const message = 'call ensureEmbeddingReady() before embed()';
      this.config.logger?.error(message); // same sync-context caveat as complete() above
      throw new RuntimeInitError(message);
    }
    return this.ports.llmRuntime.embed(text);
  }

  // --- ConversationApi (MVP, TZ §9.2) — Mode A ---
  // Pass-through to ConversationStore (Phase 3) — cheap to wire once that
  // class exists, see this class's doc comment.

  /** Creates a new chat — `options.id` is generated if omitted (TZ §9.2). `options.systemPrompt`, if given, is inserted as the chat's first message. */
  async createChat(options?: {
    id?: string;
    title?: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    const chat = await this.conversationStore.createChat(options);
    await this.emit('chat:created', { chatId: chat.id });
    return chat;
  }

  /** Lists chats, most recently active first by default (TZ §9.2). */
  async listChats(options?: { limit?: number; offset?: number; orderBy?: 'updatedAt' | 'createdAt' }): Promise<Chat[]> {
    return this.conversationStore.listChats(options);
  }

  /** Resolves `null` if no chat with this id exists. */
  async getChat(chatId: string): Promise<Chat | null> {
    return this.conversationStore.getChat(chatId);
  }

  /** Renames a chat and bumps its `updatedAt`. */
  async renameChat(chatId: string, title: string): Promise<void> {
    await this.conversationStore.renameChat(chatId, title);
  }

  /** Deletes a chat, cascading to its messages (SQL) and session-cache file (TZ §9.2). */
  async deleteChat(chatId: string): Promise<void> {
    await this.conversationStore.deleteChat(chatId);
    await this.sessionCache.deleteForChat(chatId); // the other half of TZ §9.2's cascade — SQL + session file
    await this.emit('chat:deleted', { chatId });
  }

  /** Returns a chat's full stored message history, oldest first, unaffected by any context-window truncation applied during generation (TZ §9.7). */
  async getMessages(chatId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    return this.conversationStore.getMessages(chatId, options);
  }

  /**
   * MVP `ConversationApi.sendMessage()` — TZ §9.3/§9.4/§9.7/§9.8. The user
   * message is saved *before* generation starts, in the very first step of
   * the returned stream's `result`, so it survives even a same-tick
   * `RuntimeBusyError` (TZ §9.8). Cancel/error semantics per TZ §9.8's
   * table: a normal completion, an `AbortSignal` cancellation, and a
   * runtime error *all* resolve `result` with a `ChatMessage` (status
   * `'complete'`/`'cancelled'`/`'error'` respectively) — `result` only
   * *rejects* when generation never started at all (`RuntimeBusyError`,
   * `ContextWindowExceededError`), in which case the user message is still
   * safely persisted, just with no assistant reply.
   */
  sendMessage(
    chatId: string,
    text: string,
    options?: {
      userMessageId?: string;
      assistantMessageId?: string;
      completionOptions?: CompletionOptions;
      signal?: AbortSignal;
    },
  ): CompletionStream<ChatMessage> {
    if (!this.modelLoaded || !this.currentManifest || !this.loadedModelArtifact) {
      const message = 'call ensureModelReady() before sendMessage()';
      this.config.logger?.error(message); // sendMessage() must return CompletionStream synchronously too — same caveat as complete()
      return rejectedCompletionStream(new RuntimeInitError(message));
    }
    // The actually-loaded model, not resolveSelectedModel()'s — same
    // reasoning as complete() above (multi-model plan §12.4).
    const loadedModel = this.loadedModelArtifact;
    const userMessageId = options?.userMessageId ?? globalThis.crypto.randomUUID();
    const assistantMessageId = options?.assistantMessageId ?? globalThis.crypto.randomUUID();
    const queue = new AsyncTokenQueue<CompletionToken>();

    const result = (async (): Promise<ChatMessage> => {
      // Step 1 (TZ §9.8) — save the user message before anything else can fail.
      const userCreatedAt = this.ports.clock.nowIso();
      await this.conversationStore.addMessage(chatId, {
        id: userMessageId,
        role: 'user',
        content: text,
        status: 'complete',
        createdAt: userCreatedAt,
      });
      await this.emit('chat:message-appended', { chatId, messageId: userMessageId, role: 'user' });

      // Build the context window from the full persisted history (which now includes the message just saved).
      const history = await this.conversationStore.getMessages(chatId);
      const withTokenCounts = await Promise.all(
        history.map(async (m) => ({
          role: m.role,
          content: m.content,
          tokenCount: m.tokenCount ?? (await this.ports.llmRuntime.countTokens(m.content).catch(() => estimateTokensHeuristic(m.content))),
        })),
      );
      const maxContextTokens =
        this.config.maxContextTokens ?? defaultMaxContextTokens(loadedModel.contextLength, options?.completionOptions?.maxTokens);
      // May throw ContextWindowExceededError ('fail' strategy) — the whole
      // `result` promise rejects here, which is correct: generation never
      // started, but the user message above is already durably saved.
      const windowed = buildContextWindow(withTokenCounts, {
        maxContextTokens,
        contextStrategy: this.config.contextStrategy ?? 'truncate-oldest',
        estimateTokens: estimateTokensHeuristic,
      });

      // Best-effort perf hook (TZ §9.3) — every adapter still receives the
      // full windowed history either way, so a cold start here never
      // changes correctness, only how much KV state the native plugin gets
      // to reuse under the hood.
      const modelFingerprint = `${loadedModel.id}:${loadedModel.version}`;
      await this.sessionCache.activate(chatId, modelFingerprint).catch(() => ({ loadedFromCache: false }));

      const stream = this.runtimeFacade.complete(
        { messages: windowed.messages, options: options?.completionOptions },
        { chatTemplate: loadedModel.chatTemplate },
        options?.signal,
      );
      const forwarding = (async () => {
        for await (const token of stream) queue.push(token);
        queue.close(); // our own queue is a separate instance from the facade's — draining its source doesn't close it for us
      })();

      // May reject here (RuntimeBusyError from a concurrent chat, TZ §9.4)
      // — again correct per TZ §9.8: the user message is already saved.
      const completion = await stream.result;
      await forwarding;

      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        chatId,
        role: 'assistant',
        content: completion.content,
        status: completion.status,
        createdAt: this.ports.clock.nowIso(),
        tokenCount: completion.tokenCount,
        // Carries the underlying exception's message through to the
        // persisted row on a failure — see CompletionResult.errorMessage's
        // doc comment for why this exists (2026-08-19 live bug: an error
        // with genuinely zero diagnostic trail anywhere).
        ...(completion.errorMessage || completion.reasoningContent
          ? {
              metadata: {
                ...(completion.errorMessage ? { errorMessage: completion.errorMessage } : {}),
                // `content` above is already the tag-stripped answer (see
                // CompletionResult.reasoningContent's doc comment) — this is
                // purely so a UI can optionally show "thought for N chars"
                // without needing to re-parse anything.
                ...(completion.reasoningContent ? { reasoningContent: completion.reasoningContent } : {}),
              },
            }
          : {}),
      };
      await this.conversationStore.addMessage(chatId, assistantMessage);
      await this.emit('chat:message-appended', { chatId, messageId: assistantMessageId, role: 'assistant' });
      if (completion.status === 'error') {
        await this.dispatchLog('error', `sendMessage() generation failed: ${completion.errorMessage ?? '(no error detail from runtime adapter)'}`);
      }

      if (completion.status === 'complete') {
        await this.sessionCache.save(chatId, modelFingerprint).catch(() => undefined); // best-effort, TZ §9.3 step 4
      }
      return assistantMessage;
    })();
    result.catch(() => queue.close()); // ensure the iterable side always terminates, even if we threw before `stream` existed

    return { [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](), result };
  }

  // --- ConversationSyncApi (optional, TZ §9.2/§9.6) — Mode B ---
  // Pass-through to ConversationStore, same pattern as the Mode-A methods above.

  /** Idempotent upsert by id — Mode B (TZ §9.6): creates the chat if missing; on an existing id, only `title`/`metadata`/`updatedAt` are touched, messages are never affected. */
  async upsertChat(chat: {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    return this.conversationStore.upsertChat(chat);
  }

  /** Idempotent append — Mode B (TZ §9.6): dedups by `(chatId, id)`, silently skipping messages that already exist rather than overwriting them. Implicitly creates the chat if `chatId` doesn't exist yet. */
  async appendMessages(
    chatId: string,
    messages: Array<{
      id: string;
      role: ChatMessage['role'];
      content: string;
      status?: ChatMessage['status'];
      createdAt: string;
      tokenCount?: number;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<{ inserted: number; skippedExisting: number }> {
    const result = await this.conversationStore.appendMessages(chatId, messages);
    for (const m of messages) {
      await this.emit('chat:message-appended', { chatId, messageId: m.id, role: m.role });
    }
    return result;
  }

  /** Syncs an edit to an already-stored message's content/status/metadata — Mode B (Phase 8, `docs/decisions.md` #7a). Invalidates the chat's session-cache file (its KV state was built from the old content). @throws {MessageNotFoundError} If `(chatId, messageId)` doesn't exist. */
  async updateMessage(
    chatId: string,
    messageId: string,
    updates: { content?: string; status?: ChatMessage['status']; tokenCount?: number; metadata?: Record<string, unknown> },
  ): Promise<ChatMessage> {
    const updated = await this.conversationStore.updateMessage(chatId, messageId, updates);
    await this.sessionCache.deleteForChat(chatId);
    return updated;
  }

  /** Syncs deletions made in the host app's own DB — Mode B (Phase 8, `docs/decisions.md` #7a). Unknown ids are silently not counted. Invalidates the chat's session-cache file only if something was actually deleted. */
  async deleteMessages(chatId: string, messageIds: string[]): Promise<{ deleted: number }> {
    const result = await this.conversationStore.deleteMessages(chatId, messageIds);
    if (result.deleted > 0) {
      await this.sessionCache.deleteForChat(chatId);
    }
    return result;
  }

  // --- ChatSearchApi / ChatExportApi (Phase 8, no TZ section — see docs/decisions.md) ---

  /** Full-text search across one or all chats (TZ §9.5's "can build FTS5 if needed" note, Phase 8). Backed by real FTS5 when available, a `LIKE` scan otherwise — see `chat-search:fallback-active`. */
  async searchMessages(query: string, options?: { chatId?: string; limit?: number }): Promise<ChatSearchHit[]> {
    if (!this.messageSearchIndex) {
      const message = 'search index not initialized — this should never happen after create()';
      this.config.logger?.error(message); // defensive-only guard ("should never happen after create()") — logger callback only, see emit()'s doc comment
      throw new RuntimeInitError(message);
    }
    return this.messageSearchIndex.search(query, options);
  }

  /** Exports one chat's full state, shaped to feed straight back into `upsertChat()`/`appendMessages()` for a round-trip restore (Phase 8). Resolves `null` if the chat doesn't exist. */
  async exportChat(chatId: string): Promise<ChatExport | null> {
    return this.conversationStore.exportChat(chatId);
  }

  /** Exports every chat, paginated the same way as `listChats()` (Phase 8). */
  async exportChats(options?: { limit?: number; offset?: number }): Promise<ChatExport[]> {
    return this.conversationStore.exportChats(options);
  }

  // --- LogExportApi (ROADMAP.md's "Local logging & export" section, no TZ section) ---

  /**
   * Reads persisted log entries captured while `LocalAiConfig.logging.enabled`
   * was `true` (LOG.4). `options.since` is converted to the ISO string
   * `LogStore` stores `ts` as; `options.level` is a minimum-severity
   * threshold, not an exact match — see `LogStore.query()`.
   */
  async exportLogs(options?: { since?: Date; level?: LogLevel; limit?: number }): Promise<LogEntry[]> {
    return this.logStore.query({ since: options?.since?.toISOString(), level: options?.level, limit: options?.limit });
  }

  /** Deletes every persisted log entry (LOG.4). Does not affect the pluggable `logger` callback, which isn't stateful. */
  async clearLogs(): Promise<void> {
    await this.logStore.clear();
  }

  /**
   * The active embedding's `VectorSpaceDescriptor` — throws if no
   * manifest is known yet. Prefers the actually-loaded embedding
   * ({@link loadedEmbeddingArtifact}) so an in-flight `vectors.*` call
   * reflects the runtime's real state; falls back to resolving the
   * selected model's compatible embedding when nothing is loaded yet
   * (matches the original single-model behavior — `ensureSchema()` /
   * `reindex()` are meant to work ahead of an explicit
   * `ensureEmbeddingReady()` call, multi-model plan §6 п.5).
   */
  private activeVectorSpace(): VectorSpaceDescriptor {
    if (!this.currentManifest) {
      const message = 'no manifest loaded yet — call refreshManifest()/ensureEmbeddingReady() first';
      this.config.logger?.error(message); // synchronous getter/method — logger callback only, same reasoning as complete()/sendMessage() above
      throw new RuntimeInitError(message);
    }
    const embedding =
      this.loadedEmbeddingArtifact ??
      this.resolveEmbeddingForModel(this.currentManifest, this.resolveSelectedModel(this.currentManifest).id);
    return { embeddingId: embedding.id, embeddingVersion: embedding.version, dimensions: embedding.dimensions };
  }

  private get vectorStoreOrThrow(): VectorStore {
    if (!this.vectorStore) {
      const message = 'vector store not initialized — this should never happen after create()';
      this.config.logger?.error(message); // synchronous getter — logger callback only
      throw new RuntimeInitError(message);
    }
    return this.vectorStore;
  }

  /**
   * Thin sugar over `VectorStore` that auto-fills `VectorSpaceDescriptor`
   * from the active embedding (TZ §8.2, §10) — ordinary code never has to
   * pass one by hand. `ensureSchema()` runs before every write/read, which
   * doubles as the space-mismatch guard TZ §8.2/§8.3 requires "on every
   * upsert/search": a manifest embedding change without an explicit
   * `reindex()` surfaces as `VectorSpaceMismatchError` here, not a silently
   * wrong search result.
   */
  readonly vectors = {
    upsert: async (entry: VectorEntry): Promise<void> => {
      const space = this.activeVectorSpace();
      await this.vectorStoreOrThrow.ensureSchema(space);
      await this.vectorStoreOrThrow.upsert(entry, space);
    },
    search: async (queryEmbedding: Float32Array, options?: { topK?: number; filter?: Record<string, unknown> }): Promise<VectorSearchHit[]> => {
      const space = this.activeVectorSpace();
      await this.vectorStoreOrThrow.ensureSchema(space);
      return this.vectorStoreOrThrow.search(queryEmbedding, space, options);
    },
    /** Wipes stored vectors and adopts the active embedding as the new space — the only sanctioned way past a space mismatch (TZ §8.2). */
    reindex: async (): Promise<void> => {
      await this.vectorStoreOrThrow.reindex(this.activeVectorSpace());
    },
    count: async (): Promise<number> => this.vectorStoreOrThrow.count(),
  };

  readonly downloads = {
    get: (_key: string): DownloadHandle | undefined => {
      throw new Error(NOT_IMPLEMENTED);
    },
    list: (): DownloadHandle[] => {
      throw new Error(NOT_IMPLEMENTED);
    },
  };

  /**
   * Releases native runtime contexts + in-memory caches only — see TZ
   * §11.1 for the exact boundary (never touches on-disk files, chats,
   * `download_state`, or session-cache files; only their in-memory
   * handles). Idempotent — safe to call with nothing loaded.
   */
  async releaseRuntime(options?: { closeDatabase?: boolean }): Promise<void> {
    await this.doReleaseRuntime(options, 'manual');
  }

  private async doReleaseRuntime(
    options: { closeDatabase?: boolean } | undefined,
    reason: LocalAiEventMap['runtime:unloaded']['reason'],
  ): Promise<void> {
    await this.lifecycleManager.releaseRuntime(options);
    this.modelLoaded = false;
    this.loadedModelArtifact = null;
    this.embeddingLoaded = false;
    this.loadedEmbeddingArtifact = null;
    this.currentManifest = null; // in-memory only — still recoverable from kv_store via getCachedManifest()
    this.sessionCache.resetHotHandle();
    await this.emit('runtime:unloaded', { reason });
  }

  /** @deprecated Use {@link releaseRuntime} — same method, TZ §11.0 explains the rename. */
  async unloadAll(options?: { closeDatabase?: boolean }): Promise<void> {
    return this.releaseRuntime(options);
  }

  /**
   * Explicit eager reload after a {@link releaseRuntime} — TZ §11.2
   * deliberately does *not* do this automatically on refocus (the next
   * `complete()`/`sendMessage()`/etc. call lazily raises the context on
   * its own regardless); this method exists purely for a consumer that
   * wants to pay that latency upfront instead. Re-downloads nothing new —
   * `ensureModelReady()`/`ensureEmbeddingReady()` short-circuit once the
   * artifact is already on disk and verified.
   */
  async reload(): Promise<void> {
    await this.ensureModelReady();
    await this.ensureEmbeddingReady();
  }

  /**
   * Subscribes to one of `LocalAiEventMap`'s events (TZ §10.1). Returns an
   * `Unsubscribe` function — call it to stop listening.
   * @param event Event name.
   * @param handler Called with the event's payload each time it fires.
   */
  on<E extends keyof LocalAiEventMap>(event: E, handler: (payload: LocalAiEventMap[E]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set!.delete(handler as (payload: never) => void);
  }

  /**
   * `Promise<void>`, not `void` — every caller `await`s this (see the sed'd
   * `await this.emit(...)` call sites throughout this class). That's
   * deliberate, not incidental: `dispatchLog()` below opens a `LogStore`
   * transaction on the *same* shared `SqlitePort` connection every other
   * method in this class uses, and `NodeSqliteAdapter`/`CapacitorSqliteAdapter`
   * have no internal queue — two overlapping, un-awaited `transaction()`
   * calls on one connection throw "cannot start a transaction within a
   * transaction". Awaiting `emit()` end-to-end is what keeps LOG.3's
   * "every event logs itself for free" from corrupting whatever `await
   * this.conversationStore.xyz(...)` runs immediately after it in the
   * caller. The one exception is `download:progress` (see below).
   */
  private async emit<E extends keyof LocalAiEventMap>(event: E, payload: LocalAiEventMap[E]): Promise<void> {
    // LOG.3 — every LocalAiEventMap event logs itself for free through this
    // single choke point, at the severity in EVENT_LOG_LEVEL — except
    // 'download:progress', which fires at high frequency during a single
    // download (would blow through logging.maxEntries almost instantly and
    // evict everything else) and is the one event fired from a genuinely
    // synchronous, non-`await`-able callback context
    // (`DownloadTransportPort`'s `onProgress: (p) => void`). Skipping
    // LogStore entirely for it means that fire-and-forget call site never
    // opens a transaction, so it's safe to leave un-awaited there. The
    // pluggable `logger` callback still receives it either way.
    if (event === 'download:progress') {
      this.config.logger?.debug(event, payload as unknown as Record<string, unknown>);
    } else {
      await this.dispatchLog(EVENT_LOG_LEVEL[event], event, payload as unknown as Record<string, unknown>);
    }
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) (handler as (payload: LocalAiEventMap[E]) => void)(payload);
  }

  /**
   * LOG.3's internal log-dispatch helper — (a) always calls `config.logger`
   * if supplied, with the raw `meta` (may contain a real `Error`, fine for
   * an in-process callback); (b) additionally appends to `LogStore` when
   * `config.logging.enabled` and `level` meets `config.logging.minLevel`
   * (default `'info'`), with `meta` sanitized to a JSON-safe shape first.
   * Never throws — a logging failure must never break the caller that
   * triggered it. Only ever called from an already-`async` context that can
   * safely `await` it (see {@link emit}'s doc comment on why this can't be
   * fire-and-forget); the handful of throw sites on genuinely synchronous
   * methods (`complete()`, `sendMessage()`'s pre-check, the defensive
   * "should never happen after create()" guards) call `config.logger`
   * directly instead of going through here, for the same reason.
   */
  private async dispatchLog(level: LogLevel, message: string, meta?: Record<string, unknown>): Promise<void> {
    this.config.logger?.[level](message, meta);
    const logging = this.config.logging;
    if (!logging?.enabled) return;
    if (!levelMeetsThreshold(level, logging.minLevel ?? 'info')) return;
    try {
      await this.logStore.append({ level, message, meta: sanitizeLogMeta(meta) });
    } catch {
      // best-effort — a persisted-logging failure must never break the caller.
    }
  }

  /**
   * Full teardown — releases the runtime *and* closes the database
   * connection, stops listening for app-lifecycle transitions, and drops
   * every registered event handler. Not part of TZ §11's release-boundary
   * table (that's `releaseRuntime()`'s job specifically) — this is the
   * "I'm done with this `LocalAiClient` instance entirely" method.
   */
  async destroy(): Promise<void> {
    this.lifecycleManager.disableAutoUnloadOnBackground();
    await this.doReleaseRuntime({ closeDatabase: true }, 'manual');
    this.listeners.clear();
  }
}

// Re-exported so callers importing only this module still get the token
// type without a second import from core/types.js.
export type { CompletionToken };
