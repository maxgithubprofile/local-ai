import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { DownloadTransportPort } from '../../core/ports/download-transport.port.js';
import type { Unsubscribe } from '../../core/types.js';

type TransportState = 'pending' | 'running' | 'paused' | 'done' | 'error';

interface TaskRecord {
  id: string;
  url: string;
  destinationPath: string;
  headers?: Record<string, string>;
  state: TransportState;
  progressPercent: number;
  errorMessage?: string;
  controller?: AbortController;
}

/**
 * Pure-Node `DownloadTransportPort` using `fetch` with manual
 * `Range: bytes=start-` requests — TZ §7.3. Two purposes: (1) test
 * `DownloadEngine` against a local mock HTTP server that drops connections
 * / changes `ETag` / omits `Accept-Ranges` (`test/integration/download/`);
 * (2) serve as the blueprint for a `CapacitorHttp`-based fallback adapter
 * if `@capgo/capacitor-downloader` fails real-device confirmation
 * (`docs/adr/0003-capgo-capacitor-downloader.md`).
 *
 * Resume strategy: on `start()`/`resume()`, if `destinationPath` already
 * has bytes on disk, request `Range: bytes=<existing size>-`. A `206
 * Partial Content` response appends; a `200 OK` response (server ignored
 * the Range header — no `Accept-Ranges` support) discards the existing
 * partial and restarts from byte 0, since appending a full-content
 * response to existing bytes would corrupt the file.
 */
export class NodeRangeDownloadAdapter implements DownloadTransportPort {
  readonly supportsResume = true;
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly progressListeners = new Set<(e: { id: string; progressPercent: number }) => void>();
  private readonly completedListeners = new Set<(e: { id: string }) => void>();
  private readonly failedListeners = new Set<(e: { id: string; error: string }) => void>();

  async start(task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void> {
    const record: TaskRecord = {
      id: task.id,
      url: task.url,
      destinationPath: task.destinationPath,
      headers: task.headers,
      state: 'pending',
      progressPercent: 0,
    };
    this.tasks.set(task.id, record);
    this.runDownload(record);
  }

  async pause(id: string): Promise<void> {
    const record = this.tasks.get(id);
    if (!record) return;
    record.controller?.abort();
    if (record.state === 'running') record.state = 'paused';
  }

  async resume(id: string): Promise<void> {
    const record = this.tasks.get(id);
    if (!record) return;
    if (record.state === 'running') return;
    this.runDownload(record);
  }

  async stop(id: string, options?: { discardPartial?: boolean }): Promise<void> {
    const record = this.tasks.get(id);
    if (!record) return;
    record.controller?.abort();
    if (options?.discardPartial) {
      await fsp.rm(record.destinationPath, { force: true });
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
    const controller = new AbortController();
    record.controller = controller;

    try {
      const existingBytes = await this.existingFileSize(record.destinationPath);
      const headers: Record<string, string> = { ...record.headers };
      if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`;

      const response = await fetch(record.url, { headers, signal: controller.signal });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      if (!response.body) throw new Error('response has no body');

      const isResuming = response.status === 206;
      if (!isResuming && existingBytes > 0) {
        // Server ignored our Range request — restart from scratch rather than
        // append a full response on top of stale partial bytes.
        await fsp.rm(record.destinationPath, { force: true });
      }

      await fsp.mkdir(nodePathDirname(record.destinationPath), { recursive: true });
      const fileHandle = fs.createWriteStream(record.destinationPath, { flags: isResuming ? 'a' : 'w' });

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength
        ? (isResuming ? existingBytes : 0) + Number(contentLength)
        : undefined;
      let bytesSoFar = isResuming ? existingBytes : 0;

      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await new Promise<void>((resolve, reject) => {
          fileHandle.write(value, (err) => (err ? reject(err) : resolve()));
        });
        bytesSoFar += value.length;
        record.progressPercent = totalBytes ? Math.min(100, Math.round((bytesSoFar / totalBytes) * 100)) : 0;
        for (const cb of this.progressListeners) cb({ id: record.id, progressPercent: record.progressPercent });
      }
      await new Promise<void>((resolve, reject) => fileHandle.end((err: unknown) => (err ? reject(err) : resolve())));

      record.state = 'done';
      record.progressPercent = 100;
      for (const cb of this.completedListeners) cb({ id: record.id });
    } catch (err) {
      if (controller.signal.aborted) return; // pause()/stop() — not a failure.
      record.state = 'error';
      record.errorMessage = (err as Error).message;
      for (const cb of this.failedListeners) cb({ id: record.id, error: record.errorMessage });
    }
  }

  private async existingFileSize(destinationPath: string): Promise<number> {
    try {
      const stat = await fsp.stat(destinationPath);
      return stat.size;
    } catch {
      return 0;
    }
  }
}

function nodePathDirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '.' : p.slice(0, idx);
}
