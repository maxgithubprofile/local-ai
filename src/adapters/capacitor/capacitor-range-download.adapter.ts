import { CapacitorHttp } from '@capacitor/core';
import type { DownloadTransportPort } from '../../core/ports/download-transport.port.js';
import type { FileSystemPort } from '../../core/ports/filesystem.port.js';
import type { Unsubscribe } from '../../core/types.js';
import { base64ToBytes } from '../shared/base64.js';

type TransportState = 'pending' | 'running' | 'paused' | 'done' | 'error';

interface TaskRecord {
  id: string;
  url: string;
  destinationPath: string;
  headers?: Record<string, string>;
  state: TransportState;
  progressPercent: number;
  errorMessage?: string;
  cancelled: boolean;
}

const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024; // 8MB — see class doc comment for the tradeoff this balances.

/** Parses `Content-Range: bytes 0-8388607/2497280256` → `2497280256`. Returns undefined if absent/malformed. */
function parseTotalFromContentRange(headerValue: string | undefined): number | undefined {
  const match = headerValue ? /\/(\d+)\s*$/.exec(headerValue) : null;
  return match?.[1] ? Number(match[1]) : undefined;
}

/**
 * Real byte-level-resumable `DownloadTransportPort` for Android/iOS, built
 * because `CapgoDownloaderAdapter` (Android `DownloadManager`) turned out to
 * have none — confirmed on-device 2026-08-19, its `pause()`/`resume()`
 * unconditionally reject "not supported on Android"
 * (`docs/adr/0003-capgo-capacitor-downloader.md`'s real-device confirmation
 * section, `docs/decisions.md`'s "no real resume on Android" entry).
 *
 * Uses `@capacitor/core`'s `CapacitorHttp` (routes through native
 * `URLConnection`/`URLSession`, not the WebView's `fetch` — sidesteps the
 * CORS enforcement a plain `fetch()` hits, same reasoning as
 * `docs/plans/llama2/device-ai-loop.md`'s manifest-CORS finding) issuing
 * repeated `Range:` requests in fixed-size chunks, since `CapacitorHttp` has
 * no streaming-response API (unlike Node's `fetch`, which
 * `NodeRangeDownloadAdapter` streams from directly) — one giant
 * multi-gigabyte response decoded from base64 in one shot would be a real
 * OOM risk on the low-end devices this project targets (`CLAUDE.md`'s
 * Android-compatibility focus), so this chunks deliberately instead.
 * `DEFAULT_CHUNK_BYTES` (8MB) balances two costs: too small means too many
 * JS↔native bridge round-trips (each with base64 encode/decode overhead);
 * too large risks the same OOM concern this design exists to avoid. Not
 * device-calibrated — revisit if a real low-end device shows this needs
 * tuning.
 *
 * Resume strategy: on `start()`, `fileSystem.stat()` the existing partial
 * file's size and request `Range: bytes=<existing size>-`. If the server
 * doesn't honor `Range` (responds `200` instead of `206`), the partial file
 * is deleted and the download fails rather than silently mis-processing a
 * full-content response as if it were one small chunk — safe-by-construction
 * rather than risking a corrupt/oversized in-memory response. Untested
 * against a non-Range-supporting host in practice; Hugging Face (this
 * library's only real download source so far) reliably supports `Range`.
 */
export class CapacitorRangeDownloadAdapter implements DownloadTransportPort {
  readonly supportsResume = true;
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly progressListeners = new Set<(e: { id: string; progressPercent: number }) => void>();
  private readonly completedListeners = new Set<(e: { id: string }) => void>();
  private readonly failedListeners = new Set<(e: { id: string; error: string }) => void>();

  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly chunkBytes: number = DEFAULT_CHUNK_BYTES,
  ) {}

  async start(task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void> {
    const record: TaskRecord = {
      id: task.id,
      url: task.url,
      destinationPath: task.destinationPath,
      headers: task.headers,
      state: 'pending',
      progressPercent: 0,
      cancelled: false,
    };
    this.tasks.set(task.id, record);
    void this.runDownload(record);
  }

  async pause(id: string): Promise<void> {
    const record = this.tasks.get(id);
    if (!record) return;
    record.cancelled = true;
    if (record.state === 'running') record.state = 'paused';
  }

  async resume(id: string): Promise<void> {
    const record = this.tasks.get(id);
    if (!record) return;
    if (record.state === 'running') return;
    record.cancelled = false;
    void this.runDownload(record);
  }

  async stop(id: string, options?: { discardPartial?: boolean }): Promise<void> {
    const record = this.tasks.get(id);
    if (!record) return;
    record.cancelled = true;
    if (options?.discardPartial) {
      await this.fileSystem.deleteFile(record.destinationPath).catch(() => undefined);
    }
    this.tasks.delete(id);
  }

  async status(
    id: string,
  ): Promise<{ state: TransportState; progressPercent: number; errorMessage?: string }> {
    const record = this.tasks.get(id);
    if (!record) return { state: 'error', progressPercent: 0, errorMessage: `unknown task id: ${id}` };
    return { state: record.state, progressPercent: record.progressPercent, errorMessage: record.errorMessage };
  }

  onProgress(cb: (e: { id: string; progressPercent: number }) => void): Unsubscribe {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  onCompleted(cb: (e: { id: string }) => void): Unsubscribe {
    this.completedListeners.add(cb);
    return () => this.completedListeners.delete(cb);
  }

  onFailed(cb: (e: { id: string; error: string }) => void): Unsubscribe {
    this.failedListeners.add(cb);
    return () => this.failedListeners.delete(cb);
  }

  private async runDownload(record: TaskRecord): Promise<void> {
    record.state = 'running';
    record.errorMessage = undefined;

    try {
      let bytesSoFar = (await this.fileSystem.stat(record.destinationPath))?.sizeBytes ?? 0;
      let totalBytes: number | undefined;

      for (;;) {
        if (record.cancelled) return; // pause()/stop() — not a failure.

        const rangeEnd = bytesSoFar + this.chunkBytes - 1;
        const response = await CapacitorHttp.request({
          url: record.url,
          method: 'GET',
          headers: { ...record.headers, Range: `bytes=${bytesSoFar}-${rangeEnd}` },
          responseType: 'arraybuffer',
          readTimeout: 60_000,
          connectTimeout: 30_000,
        });

        if (response.status !== 206) {
          // Server doesn't honor Range (ignored it and would return the
          // whole file as one response) — bail rather than risk decoding a
          // multi-gigabyte base64 string in one shot. See class doc comment.
          throw new Error(`server does not support Range requests (status ${response.status}, expected 206)`);
        }

        totalBytes ??= parseTotalFromContentRange(response.headers['content-range'] ?? response.headers['Content-Range']);

        const chunk =
          typeof response.data === 'string'
            ? base64ToBytes(response.data)
            : new Uint8Array(await (response.data as Blob).arrayBuffer());
        if (chunk.length === 0) break; // nothing left to read — treat as done even if Content-Range parsing failed.

        await this.fileSystem.appendFile(record.destinationPath, chunk);
        bytesSoFar += chunk.length;

        record.progressPercent = totalBytes ? Math.min(100, Math.round((bytesSoFar / totalBytes) * 100)) : 0;
        for (const cb of this.progressListeners) cb({ id: record.id, progressPercent: record.progressPercent });

        if (totalBytes !== undefined && bytesSoFar >= totalBytes) break;
        if (chunk.length < this.chunkBytes) break; // short chunk with no Content-Range total — end of file.
      }

      record.state = 'done';
      record.progressPercent = 100;
      for (const cb of this.completedListeners) cb({ id: record.id });
    } catch (err) {
      if (record.cancelled) return; // pause()/stop() raced with an in-flight request's rejection.
      record.state = 'error';
      record.errorMessage = (err as Error).message;
      for (const cb of this.failedListeners) cb({ id: record.id, error: record.errorMessage });
    }
  }
}
