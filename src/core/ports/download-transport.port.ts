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
