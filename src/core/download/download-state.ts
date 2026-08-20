import type { Unsubscribe } from '../types.js';

/**
 * Persistent download state — TZ §7.2. Lives in the `download_state` SQL
 * table (TZ §8.1) so progress survives an app restart independently of
 * whether the native transport itself remembers the task after the process
 * was killed (open question until the Phase 0 spike, TZ §7.2).
 */
export interface DownloadState {
  key: string;
  transportTaskId: string;
  kind: 'model' | 'embedding';
  url: string;
  destinationFilename: string;
  sizeBytesExpected: number;
  sha256Expected: string;
  status: 'pending' | 'downloading' | 'paused' | 'verifying' | 'completed' | 'failed';
  progressPercent: number;
  attempt: number;
  lastError?: string;
  updatedAt: string;
}

/** Public download progress event — TZ §7.5.
 *
 * `status: 'loading'` is NOT one of `DownloadState`'s persisted statuses —
 * deliberately: it means "downloaded, verified, and now being loaded into
 * the native LLM runtime" (`LocalAiClient.ensureModelReady()`'s
 * `llmRuntime.loadModel()` step), a phase `DownloadEngine`/the SQL
 * `download_state` row have already finished with (`status: 'completed'`)
 * by the time it happens — it's `LocalAiClient`'s own transient, in-memory
 * signal, not a download state. Reuses this same event/callback rather than
 * a separate one so a consumer doesn't need a second subscription just to
 * know the difference between "still verifying" and "verified, now loading
 * into memory" — both can otherwise look identical ("100%, nothing visibly
 * happening") to a user watching a progress bar, which is exactly what was
 * reported live (2026-08-19: "скачалась модель - зависла на 100%"). */
export interface DownloadProgress {
  key: string;
  kind: 'model' | 'embedding';
  percent: number;
  approximateBytes?: number;
  status: DownloadState['status'] | 'loading';
}

/**
 * Snapshot of a possibly-interrupted download, read from disk without
 * starting/resuming it — `LocalAiClient.getModelDownloadProgress()`/
 * `getEmbeddingDownloadProgress()`. Lets a consumer show "resume from X%"
 * before the user taps download, instead of only finding out once the
 * transfer is already moving. `null` from those methods (not this type)
 * means there's nothing to report — no manifest cached yet, or no partial
 * file on disk at all.
 */
export interface PartialDownloadProgress {
  /** Bytes actually on disk right now. */
  bytesDownloaded: number;
  /** From the manifest artifact's `sizeBytes` — the target total. */
  sizeBytesExpected: number;
  /** `bytesDownloaded / sizeBytesExpected * 100`, rounded. `100` here still means "not yet verified/loaded" — checksum verification only happens once a download actually runs to completion via `ensureModelReady()`. */
  percent: number;
}

/** Public handle for an in-flight/completed download — TZ §7.5. */
export interface DownloadHandle {
  readonly key: string;
  readonly kind: 'model' | 'embedding';
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(options?: { discardPartial?: boolean }): Promise<void>;
  onProgress(cb: (p: DownloadProgress) => void): Unsubscribe;
}
