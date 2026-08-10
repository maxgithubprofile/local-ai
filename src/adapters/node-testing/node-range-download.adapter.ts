import type { DownloadTransportPort } from '../../core/ports/download-transport.port.js';
import type { Unsubscribe } from '../../core/types.js';

/**
 * Not implemented — Phase 2 (ROADMAP.md). Pure-Node `DownloadTransportPort`
 * using `fetch`/`undici` with manual `Range: bytes=start-` requests — TZ
 * §7.3. Two purposes: (1) test `DownloadEngine` against a local mock HTTP
 * server that drops connections / changes `ETag` / omits `Accept-Ranges`;
 * (2) serve as the blueprint for a `CapacitorHttp`-based fallback adapter
 * if `@capgo/capacitor-downloader` fails the Phase 0 spike.
 */
export class NodeRangeDownloadAdapter implements DownloadTransportPort {
  async start(_task: { id: string; url: string; destinationPath: string; headers?: Record<string, string> }): Promise<void> {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  async pause(_id: string): Promise<void> {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  async resume(_id: string): Promise<void> {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  async stop(_id: string, _options?: { discardPartial?: boolean }): Promise<void> {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  async status(
    _id: string,
  ): Promise<{ state: 'pending' | 'running' | 'paused' | 'done' | 'error'; progressPercent: number; errorMessage?: string }> {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  onProgress(_cb: (e: { id: string; progressPercent: number }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  onCompleted(_cb: (e: { id: string }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }

  onFailed(_cb: (e: { id: string; error: string }) => void): Unsubscribe {
    throw new Error('not implemented — see TZ §7.3, ROADMAP Phase 2');
  }
}
