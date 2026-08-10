/**
 * Not implemented — Phase 2 (ROADMAP.md). Thin orchestrator over
 * `DownloadTransportPort` (TZ §7.1/§7): loads-or-creates `DownloadState`,
 * short-circuits an already-verified artifact, retries with backoff on
 * `transport.onFailed`, and runs checksum verification on completion
 * (`checksum.ts`) before marking `status: 'completed'`. Does **not** run a
 * byte-range loop itself — that's the transport adapter's job.
 */
export class DownloadEngine {
  async downloadArtifact(): Promise<never> {
    throw new Error('not implemented — see TZ §7, ROADMAP Phase 2');
  }
}
