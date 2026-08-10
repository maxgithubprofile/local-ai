import { registerPlugin } from '@capacitor/core';
import type { DownloadTransportPort } from '../../core/ports/download-transport.port.js';
import type { Unsubscribe } from '../../core/types.js';

/** Minimal slice of `@capgo/capacitor-downloader`'s real plugin surface this adapter uses (ADR 0003). */
interface CapacitorDownloaderPlugin {
  download(options: {
    id: string;
    url: string;
    destination: string;
    headers?: Record<string, string>;
    network?: 'cellular' | 'wifi-only';
    priority?: 'high' | 'normal' | 'low';
  }): Promise<{ id: string; progress: number; state: 'PENDING' | 'RUNNING' | 'PAUSED' | 'DONE' | 'ERROR' }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<void>;
  checkStatus(options: {
    id: string;
  }): Promise<{ id: string; progress: number; state: 'PENDING' | 'RUNNING' | 'PAUSED' | 'DONE' | 'ERROR' }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: { id: string; progress: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'downloadCompleted',
    listenerFunc: (result: { id: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'downloadFailed',
    listenerFunc: (error: { id: string; error: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/** Registration name confirmed in `docs/adr/0005-native-plugin-name-constants.md` — grepped from the plugin's own native source. */
const CapacitorDownloader = registerPlugin<CapacitorDownloaderPlugin>('CapacitorDownloader');

const STATE_MAP = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  DONE: 'done',
  ERROR: 'error',
} as const satisfies Record<string, 'pending' | 'running' | 'paused' | 'done' | 'error'>;

function mapState(state: keyof typeof STATE_MAP): 'pending' | 'running' | 'paused' | 'done' | 'error' {
  return STATE_MAP[state];
}

/**
 * Wraps `@capgo/capacitor-downloader` (MPL-2.0, TZ §4.4) — native OS
 * downloader (Android `DownloadManager`-class mechanism, iOS background
 * `URLSession`) so downloads survive backgrounding. Does NOT do sha256
 * verification or byte-level progress itself (only `0-100` percent) — that
 * stays in `DownloadEngine`/`checksum.ts`. Real API confirmed in
 * `docs/adr/0003-capgo-capacitor-downloader.md`; process-kill survival is
 * unverified from this environment (no device) — `DownloadEngine` is
 * designed to always re-verify via checksum rather than trust a resumed
 * download blindly, so this adapter doesn't need to special-case that.
 *
 * The plugin's own `stop()` unconditionally deletes downloaded data (no
 * "keep partial" option) — `stop(id, { discardPartial: false })` here maps
 * to the plugin's `pause()` instead, which *does* keep partial data
 * resumable, to still honor the port's contract as closely as the
 * underlying plugin allows.
 */
export class CapgoDownloaderAdapter implements DownloadTransportPort {
  private readonly progressListeners = new Set<(e: { id: string; progressPercent: number }) => void>();
  private readonly completedListeners = new Set<(e: { id: string }) => void>();
  private readonly failedListeners = new Set<(e: { id: string; error: string }) => void>();
  private listenersReady: Promise<void> | null = null;

  private async ensureNativeListeners(): Promise<void> {
    if (this.listenersReady) return this.listenersReady;
    this.listenersReady = (async () => {
      await CapacitorDownloader.addListener('downloadProgress', (e) => {
        for (const cb of this.progressListeners) cb({ id: e.id, progressPercent: e.progress });
      });
      await CapacitorDownloader.addListener('downloadCompleted', (e) => {
        for (const cb of this.completedListeners) cb({ id: e.id });
      });
      await CapacitorDownloader.addListener('downloadFailed', (e) => {
        for (const cb of this.failedListeners) cb({ id: e.id, error: e.error });
      });
    })();
    return this.listenersReady;
  }

  async start(task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void> {
    await this.ensureNativeListeners();
    await CapacitorDownloader.download({
      id: task.id,
      url: task.url,
      destination: task.destinationPath,
      headers: task.headers,
    });
  }

  async pause(id: string): Promise<void> {
    await CapacitorDownloader.pause({ id });
  }

  async resume(id: string): Promise<void> {
    await this.ensureNativeListeners();
    await CapacitorDownloader.resume({ id });
  }

  async stop(id: string, options?: { discardPartial?: boolean }): Promise<void> {
    if (options?.discardPartial === false) {
      await CapacitorDownloader.pause({ id }); // keeps partial data — the plugin's stop() cannot.
      return;
    }
    await CapacitorDownloader.stop({ id });
  }

  async status(
    id: string,
  ): Promise<{ state: 'pending' | 'running' | 'paused' | 'done' | 'error'; progressPercent: number; errorMessage?: string }> {
    const task = await CapacitorDownloader.checkStatus({ id });
    return { state: mapState(task.state), progressPercent: task.progress };
  }

  onProgress(cb: (e: { id: string; progressPercent: number }) => void): Unsubscribe {
    void this.ensureNativeListeners();
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  onCompleted(cb: (e: { id: string }) => void): Unsubscribe {
    void this.ensureNativeListeners();
    this.completedListeners.add(cb);
    return () => this.completedListeners.delete(cb);
  }

  onFailed(cb: (e: { id: string; error: string }) => void): Unsubscribe {
    void this.ensureNativeListeners();
    this.failedListeners.add(cb);
    return () => this.failedListeners.delete(cb);
  }
}
