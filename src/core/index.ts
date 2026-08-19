/**
 * `local-ai` core entry point — platform-free (TZ §3). Import this from
 * Node, tests, or any bundler; pair with `local-ai/adapters/capacitor` in a
 * real Capacitor app or `local-ai/adapters/node-testing` in tests.
 */
export { LocalAiClient } from './client/local-ai-client.js';
export type { LocalAiConfig, LocalAiLogger } from './client/local-ai-client.js';

export * from './errors.js';
export * from './types.js';

export type { LocalAiManifest, ModelArtifact, EmbeddingArtifact, HuggingFaceSource, UrlSource } from './manifest/manifest.schema.js';
export type { ManifestDiff } from './manifest/manifest.diff.js';

export type {
  Capability,
  SupportReport,
  DeviceSnapshot,
  EligibilityVerdict,
  LocalRuntimeVerdict,
  EligibilityReport,
} from './support/types.js';
export { evaluateEligibility } from './support/eligibility-service.js';

export type { DownloadState, DownloadProgress, DownloadHandle, PartialDownloadProgress } from './download/download-state.js';

export type {
  Chat,
  ChatMessage,
  ChatExport,
  ChatExportApi,
  ChatSearchApi,
  ChatSearchHit,
  ConversationApi,
  ConversationSyncApi,
} from './conversations/conversation.types.js';
export { DEFAULT_SESSION_CACHE_SLOTS } from './conversations/session-cache.js';

export type { VectorSpaceDescriptor, VectorEntry, VectorSearchHit, VectorStore } from './db/vector-store.js';
export type { MessageSearchIndex } from './db/message-search-index.js';

// LogLevel/LogEntry are already re-exported via `export * from './types.js'` above.
export type { LogExportApi } from './logging/logging.types.js';

export type { LocalAiPorts } from './ports/index.js';
export type {
  PlatformSupportPort,
  DeviceInfoPort,
  DownloadTransportPort,
  FileSystemPort,
  SqlitePort,
  SqliteRow,
  LlmRuntimePort,
  ClockPort,
  HashPort,
  IncrementalHasher,
  AppLifecyclePort,
} from './ports/index.js';
