import type { DownloadTransportPort } from '../ports/download-transport.port.js';
import type { FileSystemPort } from '../ports/filesystem.port.js';
import type { HashPort } from '../ports/hash.port.js';
import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { FastVerifyPort } from '../ports/fast-verify.port.js';
import { ChecksumMismatchError, DownloadError, InsufficientStorageError } from '../errors.js';
import { verifyChecksum } from './checksum.js';
import type { DownloadProgress, DownloadState } from './download-state.js';

/** Input describing one artifact to download — the fields `DownloadEngine` actually needs from a `ModelArtifact`/`EmbeddingArtifact`. */
export interface DownloadArtifactInput {
  kind: 'model' | 'embedding';
  filename: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  headers?: Record<string, string>;
}

export interface DownloadEngineOptions {
  /** Total attempts (including the first) before giving up. Default 5. */
  maxAttempts?: number;
  /** Delay before attempt `n` (0-indexed) retries. Default exponential, capped at 30s. */
  backoffMs?: (attempt: number) => number;
  /** Optional native-speed checksum — see `FastVerifyPort`'s own doc
   *  comment. Falls back to `checksum.ts`'s portable `readChunks()`+
   *  `HashPort` streaming path when omitted. */
  fastVerify?: FastVerifyPort;
}

function defaultBackoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

/**
 * Thin orchestrator over `DownloadTransportPort` (TZ §7.1/§7): loads-or-creates
 * `DownloadState` (persisted in the `download_state` SQL table, TZ §8.1),
 * short-circuits an already-verified artifact, retries with backoff on
 * `transport.onFailed`, and runs checksum verification (`checksum.ts`) on
 * completion before marking `status: 'completed'`. Does **not** run a
 * byte-range loop itself — that's the transport adapter's job; retrying
 * just means calling `transport.start()` again.
 *
 * `NodeRangeDownloadAdapter` genuinely resumes (real HTTP Range requests).
 * `CapgoDownloaderAdapter` on Android does **not** — confirmed on-device
 * 2026-08-19 by reading the plugin's Android source: `pause()`/`resume()`
 * unconditionally reject "not supported on Android", and `start()` always
 * issues a fresh `DownloadManager.enqueue()`. A retry there is a full
 * restart from byte 0, not a resume — this class deletes the previous
 * attempt's partial file first (see `runOneAttempt()`) specifically so a
 * restart doesn't also leak an orphaned "-1"/"-2" duplicate on top of
 * being a full restart. Checksum re-verification on completion (TZ §7.4)
 * still matters regardless, independent of this gap.
 */
export class DownloadEngine {
  constructor(
    private readonly transport: DownloadTransportPort,
    private readonly fileSystem: FileSystemPort,
    private readonly hash: HashPort,
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
    private readonly options: DownloadEngineOptions = {},
  ) {}

  async downloadArtifact(
    artifact: DownloadArtifactInput,
    callbacks?: { onProgress?: (p: DownloadProgress) => void },
  ): Promise<{ key: string; destinationPath: string }> {
    const key = this.computeKey(artifact.url, artifact.filename);
    const destinationPath = this.fileSystem.resolvePath(
      artifact.kind === 'model' ? 'models' : 'embeddings',
      artifact.filename,
    );

    let state = await this.loadState(key);
    if (state?.status === 'completed' && (await this.fileSystem.exists(destinationPath))) {
      return { key, destinationPath }; // already downloaded and verified — short-circuit (TZ §7.1 step 3)
    }

    if (!state) {
      state = {
        key,
        transportTaskId: key,
        kind: artifact.kind,
        url: artifact.url,
        destinationFilename: artifact.filename,
        sizeBytesExpected: artifact.sizeBytes,
        sha256Expected: artifact.sha256,
        status: 'pending',
        progressPercent: 0,
        attempt: 0,
        updatedAt: this.clock.nowIso(),
      };
    } else if (state.status === 'failed') {
      // A previous downloadArtifact() call already burned through every
      // attempt in its own maxAttempts budget and gave up — state.attempt
      // sits at maxAttempts, so without this the loop below wouldn't run
      // even once (`attempt < maxAttempts` false from the start) and this
      // call would fail immediately without trying at all. This call is a
      // fresh, separate, explicit invocation (a caller retrying after a
      // transient failure — e.g. the user tapping "resume" after their
      // connection dropped) — it gets its own full attempt budget. The
      // bytes already on disk (if the transport supports real resume)
      // aren't touched by this — only the SQL-persisted attempt counter
      // resets, so a resume-capable transport still resumes from where it
      // left off, this just stops it from being an instant no-op.
      state.attempt = 0;
      state.status = 'pending';
    }

    const maxAttempts = this.options.maxAttempts ?? 5;
    const backoffMs = this.options.backoffMs ?? defaultBackoff;

    for (let attempt = state.attempt; attempt < maxAttempts; attempt++) {
      // SEC.3 (docs/decisions.md's "Security audit (2026-08-11)" section):
      // independent of whatever eligibilityPolicy the caller configured —
      // that gate is a point-in-time, policy-overridable snapshot, not a
      // guarantee — refuse to even attempt a write that would exhaust the
      // device's storage. Checked fresh before every attempt, not just once,
      // since free space can shrink between retries.
      const free = await this.fileSystem.freeSpaceBytes(destinationPath);
      const required = artifact.sizeBytes * 1.15;
      if (free < required) {
        state.status = 'failed';
        state.lastError = 'insufficient storage';
        await this.saveState(state);
        throw new InsufficientStorageError(
          `insufficient storage for ${artifact.filename}: ${Math.ceil(required)} bytes required, ${free} available`,
        );
      }

      state.attempt = attempt + 1;
      state.status = 'downloading';
      await this.saveState(state);

      // The file can already have every expected byte without the
      // persisted state saying status: 'completed' — the SQL row and the
      // real transport can fall out of sync whenever the process restarts
      // mid-flight (the app relaunches, gets killed/updated, ...) after a
      // resume-capable transport's own OS-level component (e.g. a Kotlin
      // foreground service) finished writing but before this JS-side loop
      // ever processed that completion — confirmed happening live,
      // 2026-08-19. Skip straight to verification in that case: issuing a
      // Range request for zero remaining bytes is asking the server for
      // nothing, which it correctly rejects (416/similar) — a real
      // failure for a download that, bytes-wise, already succeeded.
      // Falls through to the normal attempt path (and, via checksum
      // verification's own mismatch handling, self-corrects) if the file
      // is merely *oversized* rather than genuinely complete — this is
      // strictly `>=`, not `===`.
      const existingStat = await this.fileSystem.stat(destinationPath);
      const alreadyHasAllBytes = !!existingStat && existingStat.sizeBytes >= artifact.sizeBytes;
      const result = alreadyHasAllBytes ? { ok: true as const } : await this.runOneAttempt(key, artifact, destinationPath, callbacks);

      if (result.ok) {
        state.status = 'verifying';
        await this.saveState(state);
        callbacks?.onProgress?.({ key, kind: artifact.kind, percent: 0, status: 'verifying' });

        // Streamed with real per-chunk progress, not a single 0%-then-silent
        // call — hashing a GB-scale GGUF through the Capacitor Filesystem
        // bridge (readChunks() → repeated readFile() round-trips, each with
        // its own base64 encode/decode) is genuinely slow, not instant the
        // way it might be for a small file. Without this, the UI had
        // nothing to show between "download reached 100%" and "verification
        // finished" — which could be the better part of a minute for a
        // multi-gigabyte model — and read as a hang (reported live,
        // 2026-08-19: "скачалась модель - зависла на 100%").
        const onVerifyProgress = (bytesHashed: number): void => {
          const percent = Math.min(100, Math.round((bytesHashed / artifact.sizeBytes) * 100));
          callbacks?.onProgress?.({ key, kind: artifact.kind, percent, status: 'verifying' });
        };
        // Native-speed path when the platform adapter provides one — see
        // FastVerifyPort's own doc comment for why this exists at all
        // (the portable readChunks()+HashPort path is fine in Node/tests,
        // but confirmed catastrophically slow — ~1.9 hours for a 2.3GB
        // file — over Capacitor's Filesystem bridge on a real device).
        const valid = this.options.fastVerify
          ? await this.options.fastVerify.sha256File(destinationPath, artifact.sha256, onVerifyProgress)
          : await verifyChecksum(destinationPath, artifact.sha256, { fileSystem: this.fileSystem, hash: this.hash }, { onProgress: onVerifyProgress });
        if (!valid) {
          await this.fileSystem.deleteFile(destinationPath);
          state.status = 'failed';
          state.lastError = 'checksum mismatch';
          await this.saveState(state);
          throw new ChecksumMismatchError(`sha256 mismatch for ${artifact.filename} after download`);
        }

        state.status = 'completed';
        state.progressPercent = 100;
        await this.saveState(state);
        callbacks?.onProgress?.({ key, kind: artifact.kind, percent: 100, status: 'completed' });
        return { key, destinationPath };
      }

      state.lastError = result.error;
      state.status = 'failed';
      await this.saveState(state);

      if (attempt + 1 >= maxAttempts) {
        throw new DownloadError(
          'download_failed',
          `download of ${artifact.filename} failed after ${maxAttempts} attempts: ${result.error}`,
        );
      }
      await delay(backoffMs(attempt));
    }

    // Unreachable given the loop bounds above, but keeps the return type total.
    throw new DownloadError('download_failed', `download of ${artifact.filename} did not complete`);
  }

  private runOneAttempt(
    key: string,
    artifact: DownloadArtifactInput,
    destinationPath: string,
    callbacks?: { onProgress?: (p: DownloadProgress) => void },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const cleanup = () => {
        unsubProgress();
        unsubCompleted();
        unsubFailed();
      };
      const unsubProgress = this.transport.onProgress((e) => {
        if (e.id !== key) return;
        callbacks?.onProgress?.({
          key,
          kind: artifact.kind,
          percent: e.progressPercent,
          approximateBytes: Math.round((e.progressPercent / 100) * artifact.sizeBytes),
          status: 'downloading',
        });
      });
      const unsubCompleted = this.transport.onCompleted((e) => {
        if (e.id !== key) return;
        cleanup();
        resolve({ ok: true });
      });
      const unsubFailed = this.transport.onFailed((e) => {
        if (e.id !== key) return;
        cleanup();
        resolve({ ok: false, error: e.error });
      });

      // If the transport can't actually resume (CapgoDownloaderAdapter on
      // Android — see DownloadTransportPort.supportsResume's doc comment),
      // a retry's start() call is a full restart, not a resume. Deleting the
      // previous attempt's partial file first stops DownloadManager from
      // auto-renaming to "-1"/"-2"/... on top of already being a restart —
      // otherwise every retry leaks a new full-size orphan file. Transports
      // that genuinely resume (NodeRangeDownloadAdapter) must keep the
      // partial file in place, or their own Range-request resume breaks.
      const beforeStart = this.transport.supportsResume
        ? Promise.resolve()
        : this.fileSystem.deleteFile(destinationPath).catch(() => undefined);

      beforeStart
        .then(() => this.transport.start({ id: key, url: artifact.url, destinationPath, headers: artifact.headers }))
        .catch((err: unknown) => {
          cleanup();
          resolve({ ok: false, error: (err as Error).message });
        });
    });
  }

  /**
   * The same deterministic key `downloadArtifact()` computes internally for
   * `url`+`filename` — lets a caller pause/resume/cancel a download by
   * artifact identity without this class exposing any other internal
   * state (`LocalAiClient.pauseModelDownload()`/`resumeModelDownload()`/
   * `deleteModel()`).
   */
  keyFor(url: string, filename: string): string {
    return this.computeKey(url, filename);
  }

  /**
   * Pauses the in-flight transfer for `key`, if any. A caller awaiting
   * `downloadArtifact()` for this same key simply stops progressing until
   * `resume()` — it does not reject or resolve while paused, since the
   * transport's own `pause()` deliberately fires neither `onCompleted` nor
   * `onFailed` (see `CapacitorRangeDownloadAdapter.pause()`). No-op if
   * nothing is running for this key.
   */
  async pause(key: string): Promise<void> {
    await this.transport.pause(key);
  }

  /**
   * Resumes a transfer paused via `pause()`, continuing from wherever it
   * left off on a transport where `supportsResume` (a full restart
   * otherwise — same distinction `runOneAttempt()`'s retry path makes).
   * No-op if nothing is paused for this key.
   */
  async resume(key: string): Promise<void> {
    await this.transport.resume(key);
  }

  /**
   * Stops any in-flight/paused transfer for `key`, clears its persisted
   * `download_state` row, and — when `discardPartial` — the file at
   * `destinationPath` too, so a later `downloadArtifact()` call for the
   * same key starts completely fresh instead of resuming or
   * short-circuiting on stale state. `destinationPath` is deleted directly
   * here (not left to `transport.stop()` alone) because the transport may
   * have no in-memory task record for this key at all — e.g. after an app
   * restart — in which case its own `stop()` would be a no-op.
   */
  async cancel(key: string, destinationPath: string, options?: { discardPartial?: boolean }): Promise<void> {
    await this.transport.stop(key, options).catch(() => undefined);
    await this.sqlite.execute('DELETE FROM download_state WHERE key = ?', [key]);
    if (options?.discardPartial) {
      await this.fileSystem.deleteFile(destinationPath).catch(() => undefined);
    }
  }

  private computeKey(url: string, filename: string): string {
    return `dl_${this.hash.sha256(new TextEncoder().encode(`${url} ${filename}`)).slice(0, 24)}`;
  }

  private async loadState(key: string): Promise<DownloadState | null> {
    const rows = await this.sqlite.query<{
      key: string;
      transport_task_id: string;
      kind: 'model' | 'embedding';
      url: string;
      destination_filename: string;
      size_bytes_expected: number;
      sha256_expected: string;
      status: DownloadState['status'];
      progress_percent: number;
      attempt: number;
      last_error: string | null;
      updated_at: string;
    }>('SELECT * FROM download_state WHERE key = ?', [key]);
    const row = rows[0];
    if (!row) return null;
    return {
      key: row.key,
      transportTaskId: row.transport_task_id,
      kind: row.kind,
      url: row.url,
      destinationFilename: row.destination_filename,
      sizeBytesExpected: row.size_bytes_expected,
      sha256Expected: row.sha256_expected,
      status: row.status,
      progressPercent: row.progress_percent,
      attempt: row.attempt,
      lastError: row.last_error ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  private async saveState(state: DownloadState): Promise<void> {
    state.updatedAt = this.clock.nowIso();
    await this.sqlite.execute(
      `INSERT INTO download_state
         (key, transport_task_id, kind, url, destination_filename, size_bytes_expected, sha256_expected, status, progress_percent, attempt, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = excluded.status,
         progress_percent = excluded.progress_percent,
         attempt = excluded.attempt,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        state.key,
        state.transportTaskId,
        state.kind,
        state.url,
        state.destinationFilename,
        state.sizeBytesExpected,
        state.sha256Expected,
        state.status,
        state.progressPercent,
        state.attempt,
        state.lastError ?? null,
        state.updatedAt,
      ],
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
