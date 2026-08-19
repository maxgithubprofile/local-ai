import type { Unsubscribe } from '../types.js';

/**
 * Port over a resumable download transport — TZ §7.1. The production adapter
 * wraps `@capgo/capacitor-downloader` (native OS downloader); the Node
 * adapter (`NodeRangeDownloadAdapter`, TZ §7.3) implements the same contract
 * on top of manual `Range:` requests for testing and as a documented
 * fallback blueprint. `DownloadEngine` (TZ §7) is a thin orchestrator over
 * this port — it does not run a byte-range loop itself.
 */
export interface DownloadTransportPort {
  /**
   * Whether calling `start()` again after an interrupted attempt actually
   * resumes from the existing partial file, or restarts from byte 0.
   * `NodeRangeDownloadAdapter` is `true` (real `Range:` requests).
   * `CapgoDownloaderAdapter` is `false` — confirmed on-device 2026-08-19:
   * the plugin's `pause()`/`resume()` unconditionally reject "not supported
   * on Android", and `start()` always issues a fresh
   * `DownloadManager.enqueue()`. `DownloadEngine` uses this to decide
   * whether a retry should delete the previous partial file first (`false`)
   * or leave it for the transport to resume from (`true`) — see
   * `docs/decisions.md`'s "no real resume on Android" entry.
   */
  readonly supportsResume: boolean;
  start(task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  stop(id: string, options?: { discardPartial?: boolean }): Promise<void>;
  status(id: string): Promise<{
    state: 'pending' | 'running' | 'paused' | 'done' | 'error';
    progressPercent: number;
    errorMessage?: string;
  }>;
  onProgress(cb: (e: { id: string; progressPercent: number }) => void): Unsubscribe;
  onCompleted(cb: (e: { id: string }) => void): Unsubscribe;
  onFailed(cb: (e: { id: string; error: string }) => void): Unsubscribe;
}
