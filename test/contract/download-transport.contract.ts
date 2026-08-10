import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadTransportPort } from '../../src/core/ports/download-transport.port.js';
import { createMockDownloadServer } from '../integration/download/mock-http-server.js';

/**
 * Shared `DownloadTransportPort` scenarios — TZ §7.1/§7.3, run against
 * every adapter that implements the port. `node-testing`
 * (`NodeRangeDownloadAdapter`) always; `CapgoDownloaderAdapter` only with a
 * real device/emulator available (not available in this environment — see
 * `docs/adr/0003-capgo-capacitor-downloader.md`), so this file is invoked
 * from exactly one concrete spec today
 * (`node-range-download.contract.test.ts`).
 */
export function defineDownloadTransportContract(createTransport: () => DownloadTransportPort) {
  describe('DownloadTransportPort contract', () => {
    let transport: DownloadTransportPort;
    let content: Buffer;
    let mockServer: ReturnType<typeof createMockDownloadServer>;
    let url: string;
    let destinationPath: string;
    let tmpDir: string;

    beforeEach(async () => {
      const { mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      tmpDir = mkdtempSync(path.join(tmpdir(), 'local-ai-download-contract-'));
      destinationPath = path.join(tmpDir, 'artifact.bin');

      content = Buffer.alloc(1_000_000);
      for (let i = 0; i < content.length; i++) content[i] = i % 256;

      mockServer = createMockDownloadServer(content);
      url = await mockServer.listen();
      transport = createTransport();
    });

    afterEach(async () => {
      await mockServer.close();
      const { rm } = await import('node:fs/promises');
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('downloads a complete file end to end', async () => {
      const completed = waitForCompletion(transport, 'task-1');
      await transport.start({ id: 'task-1', url, destinationPath });
      await completed;

      const { readFileSync } = await import('node:fs');
      expect(readFileSync(destinationPath).equals(content)).toBe(true);
    });

    it('reports progress events as the download proceeds', async () => {
      const percents: number[] = [];
      const unsub = transport.onProgress((e) => {
        if (e.id === 'task-2') percents.push(e.progressPercent);
      });
      const completed = waitForCompletion(transport, 'task-2');
      await transport.start({ id: 'task-2', url, destinationPath });
      await completed;
      unsub();

      expect(percents.length).toBeGreaterThan(0);
      expect(percents[percents.length - 1]).toBe(100);
    });

    it('resume after a connection drop at ~50% still produces the exact original bytes', async () => {
      mockServer.dropNextResponseAfter(Math.floor(content.length / 2));

      const failed = waitForFailure(transport, 'task-3');
      await transport.start({ id: 'task-3', url, destinationPath });
      await failed; // connection dropped mid-transfer

      const completed = waitForCompletion(transport, 'task-3');
      await transport.resume('task-3'); // the mock server already un-armed the drop — this succeeds
      await completed;

      const { readFileSync } = await import('node:fs');
      expect(readFileSync(destinationPath).equals(content)).toBe(true);
      expect(mockServer.requestCount).toBe(2); // one dropped, one resumed
    });

    it('restarts from scratch when the server ignores Range (no Accept-Ranges)', async () => {
      mockServer.setAcceptRanges(false);
      mockServer.dropNextResponseAfter(Math.floor(content.length / 3));

      const failed = waitForFailure(transport, 'task-4');
      await transport.start({ id: 'task-4', url, destinationPath });
      await failed;

      const completed = waitForCompletion(transport, 'task-4');
      await transport.resume('task-4');
      await completed;

      const { readFileSync } = await import('node:fs');
      expect(readFileSync(destinationPath).equals(content)).toBe(true);
    });

    it('stop({ discardPartial: true }) removes the partially-downloaded file', async () => {
      mockServer.dropNextResponseAfter(1000);
      const failed = waitForFailure(transport, 'task-5');
      await transport.start({ id: 'task-5', url, destinationPath });
      await failed;

      await transport.stop('task-5', { discardPartial: true });

      const { existsSync } = await import('node:fs');
      expect(existsSync(destinationPath)).toBe(false);
    });
  });
}

function waitForCompletion(transport: DownloadTransportPort, id: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = transport.onCompleted((e) => {
      if (e.id !== id) return;
      unsub();
      resolve();
    });
  });
}

function waitForFailure(transport: DownloadTransportPort, id: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = transport.onFailed((e) => {
      if (e.id !== id) return;
      unsub();
      resolve();
    });
  });
}
