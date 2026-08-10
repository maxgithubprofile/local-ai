import type { DownloadTransportPort } from '../../core/ports/download-transport.port.js';
import type { Unsubscribe } from '../../core/types.js';

/**
 * Not implemented — Phase 2 (ROADMAP.md). Wraps `@capgo/capacitor-downloader`
 * (MPL-2.0, TZ §4.4) — native OS downloader (Android `DownloadManager`,
 * iOS background `URLSession`) so downloads survive backgrounding. Does
 * NOT do sha256 verification or byte-level progress itself — that stays in
 * `DownloadEngine`/`checksum.ts`. Whether it survives process kill (a key
 * differentiator, TZ §17) is confirmed by the Phase 0 spike; if not, the
 * documented fallback is a `CapacitorHttp`-based adapter modeled on
 * `NodeRangeDownloadAdapter` (TZ §7.3).
 */
export class CapgoDownloaderAdapter implements DownloadTransportPort {
  async start(_task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void> {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  async pause(_id: string): Promise<void> {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  async resume(_id: string): Promise<void> {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  async stop(_id: string, _options?: { discardPartial?: boolean }): Promise<void> {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  async status(
    _id: string,
  ): Promise<{ state: 'pending' | 'running' | 'paused' | 'done' | 'error'; progressPercent: number; errorMessage?: string }> {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  onProgress(_cb: (e: { id: string; progressPercent: number }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  onCompleted(_cb: (e: { id: string }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }

  onFailed(_cb: (e: { id: string; error: string }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §4.4, §7, ROADMAP Phase 2');
  }
}
