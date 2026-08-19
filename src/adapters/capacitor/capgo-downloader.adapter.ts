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
  }): Promise<{ id: string; status: number }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<void>;
  /**
   * Real return shape (confirmed by reading the plugin's Android source,
   * `getDownloadStatus()` in `CapacitorDownloaderPlugin.java` — found
   * on-device 2026-08-19, does NOT match what an earlier version of this
   * file assumed): raw `android.app.DownloadManager` column values, not a
   * friendly `{progress, state}` pair. `status` is one of
   * `DownloadManager.STATUS_*` (`PENDING=1`, `RUNNING=2`, `PAUSED=4`,
   * `SUCCESSFUL=8`, `FAILED=16`) — see {@link mapDownloadManagerStatus}.
   */
  checkStatus(options: {
    id: string;
  }): Promise<{ status: number; bytesDownloaded: number; bytesTotal: number; reason?: number; reasonText?: string }>;
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

/**
 * `android.app.DownloadManager.STATUS_*` int constants — hardcoded here
 * because the plugin's `checkStatus()` returns the raw column value, not a
 * decoded string (see that method's doc comment above).
 */
const DOWNLOAD_MANAGER_STATUS = {
  PENDING: 1,
  RUNNING: 2,
  PAUSED: 4,
  SUCCESSFUL: 8,
  FAILED: 16,
} as const;

function mapDownloadManagerStatus(status: number): 'pending' | 'running' | 'paused' | 'done' | 'error' {
  switch (status) {
    case DOWNLOAD_MANAGER_STATUS.PENDING:
      return 'pending';
    case DOWNLOAD_MANAGER_STATUS.RUNNING:
      return 'running';
    case DOWNLOAD_MANAGER_STATUS.PAUSED:
      return 'paused';
    case DOWNLOAD_MANAGER_STATUS.SUCCESSFUL:
      return 'done';
    default:
      // FAILED (16) and any unrecognized value — status() has no separate
      // "unknown" state to report, and silently mapping to something other
      // than error would hide a real failure from a caller polling status().
      return 'error';
  }
}

/**
 * Wraps `@capgo/capacitor-downloader` (MPL-2.0, TZ §4.4) — native OS
 * downloader (Android `DownloadManager`-class mechanism, iOS background
 * `URLSession`) so downloads survive backgrounding. Does NOT do sha256
 * verification itself — that stays in `DownloadEngine`/`checksum.ts`. This
 * adapter normalizes the plugin's real Android shapes (raw `progress`
 * fraction, raw `DownloadManager.STATUS_*` int) to the port's `0-100`
 * percent / friendly-state contract — see `onProgress`'s and `checkStatus`'s
 * doc comments for what the plugin actually sends, confirmed on-device
 * 2026-08-19 (`docs/adr/0003-capgo-capacitor-downloader.md` needs a status
 * update to reflect this — was `proposed` on source-reading alone, this is
 * the first real-device confirmation and it found three real gaps).
 * Process-kill survival: confirmed, but not the way `docs/decisions.md`
 * hoped — `pause()`/`resume()` unconditionally reject "not supported on
 * Android" in the plugin's own source, so a retry after the app restarts is
 * always a full restart, never a byte-level resume. `supportsResume: false`
 * tells `DownloadEngine` to delete the previous attempt's partial file
 * before retrying (otherwise `DownloadManager.enqueue()` against an
 * already-existing destination just leaks a "-1"/"-2"/... orphan on every
 * retry rather than overwriting it) — checksum re-verification on
 * completion still matters regardless, independent of this gap.
 *
 * The plugin's own `stop()` unconditionally deletes downloaded data (no
 * "keep partial" option) — `stop(id, { discardPartial: false })` here maps
 * to the plugin's `pause()` instead, which *does* keep partial data
 * resumable, to still honor the port's contract as closely as the
 * underlying plugin allows.
 */
export class CapgoDownloaderAdapter implements DownloadTransportPort {
  readonly supportsResume = false;
  private readonly progressListeners = new Set<(e: { id: string; progressPercent: number }) => void>();
  private readonly completedListeners = new Set<(e: { id: string }) => void>();
  private readonly failedListeners = new Set<(e: { id: string; error: string }) => void>();
  private listenersReady: Promise<void> | null = null;

  private async ensureNativeListeners(): Promise<void> {
    if (this.listenersReady) return this.listenersReady;
    this.listenersReady = (async () => {
      await CapacitorDownloader.addListener('downloadProgress', (e) => {
        // `e.progress` is a 0..1 fraction on the real plugin (bytesDownloaded
        // / bytesTotal in the Android source), not 0-100 as this file used to
        // assume — found on-device 2026-08-19: the download UI stayed stuck
        // showing "0%" for the entire multi-minute transfer because
        // Math.round(0.14) still rounds to 0. See checkStatus()'s doc
        // comment for the same real-shape-vs-assumed-shape gap in status().
        for (const cb of this.progressListeners) cb({ id: e.id, progressPercent: e.progress * 100 });
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
    const progressPercent = task.bytesTotal > 0 ? (task.bytesDownloaded / task.bytesTotal) * 100 : 0;
    const state = mapDownloadManagerStatus(task.status);
    return state === 'error' ? { state, progressPercent, errorMessage: task.reasonText ?? `download failed (status ${task.status})` } : { state, progressPercent };
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
