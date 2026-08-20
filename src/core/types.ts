import type { ManifestDiff } from './manifest/manifest.diff.js';
import type { DownloadProgress } from './download/download-state.js';
import type { EligibilityReport } from './support/types.js';
import type { ChatMessage } from './conversations/conversation.types.js';

/** Sampling/generation parameters — TZ §10.0. */
export interface CompletionOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  repeatPenalty?: number;
  seed?: number;
  stop?: string[];
  /**
   * Skip a reasoning-capable model's `<think>...</think>` phase before the
   * real answer — perf-tuning plan §4 (`docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md`
   * in the `forta.chat` repo). `undefined` = don't touch it, plugin/model
   * decide on their own (library stays unopinionated, same pattern as
   * `autoUnloadOnBackground`'s own default). Only takes effect through the
   * plugin's native jinja templating (mechanism 1) — the ChatML fallback
   * path in `LlamaCppCapacitorAdapter` handles "skip thinking" a different
   * way (an already-closed `<think></think>` prefix) because that path
   * never goes through templating at all.
   */
  enableThinking?: boolean;
}

/**
 * Only structured messages — the library NEVER accepts a raw prompt
 * string, so a model swap in the manifest can't silently degrade quality
 * because the app hand-rolled its own chat-template glue. See TZ §4.1.
 */
export interface CompletionInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  options?: CompletionOptions;
}

/** Non-streaming completion result — TZ §10.0. */
export interface CompletionResult {
  content: string;
  status: 'complete' | 'cancelled' | 'error';
  tokenCount?: number;
  /**
   * The underlying exception's message when `status: 'error'` — TZ §9.8's
   * "mid-generation failures resolve, never reject" contract means the
   * actual native error would otherwise be discarded entirely, leaving
   * both the UI and logs with no way to tell *why* generation failed.
   * `LocalAiClient.sendMessage()` copies this into the persisted
   * `ChatMessage.metadata.errorMessage` (2026-08-19 live bug: a real
   * failure surfaced only as an opaque "не удалось сгенерировать ответ",
   * with zero diagnostic trail in logcat or here).
   */
  errorMessage?: string;
  /** Chain-of-thought extracted from a `<think>...</think>` block, if the model produced one — see `splitReasoningContent()`'s doc comment. `content` never contains the raw tags. */
  reasoningContent?: string;
}

/** One streamed token as seen by a `for await` subscriber — TZ §10.0. */
export interface CompletionToken {
  token: string;
  /** Text accumulated since generation start — saves the subscriber from concatenating itself. */
  accumulatedContent: string;
}

/**
 * Explicit replacement for a hybrid `AsyncIterable & Promise` (rejected in
 * `docs/corrections.txt` as awkward to implement/test reliably) — TZ §9.2,
 * §10.0. `result` resolves after the stream fully drains — success,
 * cancellation, and mid-generation errors all *resolve* (never reject) with
 * a final value carrying the corresponding `status`, see TZ §9.8. `result`
 * only *rejects* when generation couldn't start at all
 * (`RuntimeBusyError`/`ContextWindowExceededError`).
 */
export interface CompletionStream<TResult> extends AsyncIterable<CompletionToken> {
  readonly result: Promise<TResult>;
}

/** Event payloads for `LocalAiClient.on()` — TZ §10.1. */
export interface LocalAiEventMap {
  'manifest:updated': ManifestDiff;
  'manifest:invalid': { error: Error };
  'device:eligibility-warning': EligibilityReport;
  'download:progress': DownloadProgress;
  'download:completed': { key: string; kind: 'model' | 'embedding' };
  'download:failed': { key: string; kind: 'model' | 'embedding'; error: Error };
  'runtime:model-loaded': { modelId: string; version: number };
  'runtime:embedding-loaded': { embeddingId: string; version: number };
  'runtime:unloaded': { reason: 'manual' | 'background' | 'model-switch' | 'embedding-switch' | 'model-deleted' };
  'vector-store:fallback-active': { reason: string };
  /** Phase 8 — `createMessageSearchIndex()` fell back to `LikeMessageSearchIndex` (FTS5 unavailable/failed its self-test on this device). See `docs/decisions.md`'s "Full-text search" entry. */
  'chat-search:fallback-active': { reason: string };
  'vector-store:embedding-changed': {
    previous?: { id: string; version: number; dimensions: number };
    current: { id: string; version: number; dimensions: number };
    dimensionsChanged: boolean;
  };
  'chat:created': { chatId: string };
  'chat:deleted': { chatId: string };
  'chat:message-appended': { chatId: string; messageId: string; role: ChatMessage['role'] };
}

/** Context-window handling strategy when a chat's history exceeds `maxContextTokens` — TZ §9.7. */
export type ContextStrategy = 'fail' | 'truncate-oldest' | 'truncate-to-fit';

/**
 * Severity of a log entry — shared by the pluggable {@link LocalAiLogger}
 * callback (TZ §14) and the persisted `LogStore` (ROADMAP.md's "Local
 * logging & export" section, not a TZ concept). Ordered `debug` < `info` <
 * `warn` < `error`; `LocalAiConfig.logging.minLevel` and `exportLogs()`'s
 * `level` filter both compare against this order, not exact equality.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * One persisted log row, as returned by `LocalAiClient.exportLogs()` — see
 * `docs/guides/logging-and-export.md`. Only ever produced when
 * `LocalAiConfig.logging.enabled` was `true` at the time the entry was
 * captured; `id` is the row's autoincrement primary key, useful for a
 * consumer that wants to dedupe across repeated exports.
 */
export interface LogEntry {
  id: number;
  /** ISO-8601 timestamp, same convention as every other `*_at` field in this package's public types. */
  ts: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

/** `Unsubscribe` handles returned by `on()`/port event registrations. */
export type Unsubscribe = () => void;
