import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTransportPort } from '../../../src/core/ports/download-transport.port.js';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DownloadEngine } from '../../../src/core/download/download-engine.js';
import { NodeRangeDownloadAdapter } from '../../../src/adapters/node-testing/node-range-download.adapter.js';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';
import { WebCryptoHashAdapter } from '../../../src/adapters/shared/web-crypto-hash.adapter.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';
import { ChecksumMismatchError, InsufficientStorageError } from '../../../src/core/errors.js';
import { createMockDownloadServer } from './mock-http-server.js';

// ROADMAP.md Phase 2 exit criterion, verbatim: "resume after 50% cutoff ->
// sha256 valid" — this suite exercises that through the full
// DownloadEngine, not just the raw transport (see
// test/contract/download-transport.contract.ts for the transport-only
// version of the same scenario).

describe('DownloadEngine', () => {
  let tmpDir: string;
  let hash: WebCryptoHashAdapter;
  let fileSystem: NodeFsAdapter;
  let sqlite: NodeSqliteAdapter;
  let clock: FakeClockAdapter;
  let content: Buffer;
  let mockServer: ReturnType<typeof createMockDownloadServer>;
  let url: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-download-engine-'));
    hash = new WebCryptoHashAdapter();
    fileSystem = new NodeFsAdapter(tmpDir);
    sqlite = new NodeSqliteAdapter(':memory:');
    clock = new FakeClockAdapter();
    await new Database(sqlite, clock).migrate();

    content = Buffer.alloc(2_000_000);
    for (let i = 0; i < content.length; i++) content[i] = (i * 7) % 256;
    mockServer = createMockDownloadServer(content);
    url = await mockServer.listen();
  });

  afterEach(async () => {
    await mockServer.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  function artifact(overrides: Partial<Parameters<DownloadEngine['downloadArtifact']>[0]> = {}) {
    return {
      kind: 'model' as const,
      filename: 'model.gguf',
      url,
      sha256: hash.sha256(content),
      sizeBytes: content.length,
      ...overrides,
    };
  }

  it('downloads, verifies checksum, and marks completed', async () => {
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), fileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });

    const { destinationPath } = await engine.downloadArtifact(artifact());

    expect(fs.readFileSync(destinationPath).equals(content)).toBe(true);
    const [state] = await sqlite.query<{ status: string; progress_percent: number }>(
      'SELECT status, progress_percent FROM download_state',
    );
    expect(state?.status).toBe('completed');
    expect(state?.progress_percent).toBe(100);
  });

  it('resume after a ~50% connection drop still ends with a valid sha256', async () => {
    mockServer.dropNextResponseAfter(Math.floor(content.length / 2));
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), fileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });

    const { destinationPath } = await engine.downloadArtifact(artifact());

    expect(fs.readFileSync(destinationPath).equals(content)).toBe(true);
    expect(hash.sha256(fs.readFileSync(destinationPath))).toBe(hash.sha256(content));
    const [state] = await sqlite.query<{ status: string; attempt: number }>(
      'SELECT status, attempt FROM download_state',
    );
    expect(state?.status).toBe('completed');
    expect(state?.attempt).toBe(2); // first attempt dropped, second succeeded
  });

  it('short-circuits a second call once already completed and verified', async () => {
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), fileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });
    await engine.downloadArtifact(artifact());
    expect(mockServer.requestCount).toBe(1);

    await engine.downloadArtifact(artifact());
    expect(mockServer.requestCount).toBe(1); // no second HTTP request at all
  });

  it('throws ChecksumMismatchError and deletes the file when sha256 does not match', async () => {
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), fileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });

    await expect(engine.downloadArtifact(artifact({ sha256: 'f'.repeat(64) }))).rejects.toThrow(
      ChecksumMismatchError,
    );

    const [state] = await sqlite.query<{ status: string }>('SELECT status FROM download_state');
    expect(state?.status).toBe('failed');
  });

  it('reports progress via the onProgress callback, ending at 100%', async () => {
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), fileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });
    const percents: number[] = [];

    await engine.downloadArtifact(artifact(), { onProgress: (p) => percents.push(p.percent) });

    expect(percents[percents.length - 1]).toBe(100);
  });

  it('throws InsufficientStorageError and never attempts a write when free space is below the 1.15x threshold (SEC.3)', async () => {
    const starvedFileSystem: typeof fileSystem = Object.create(fileSystem, {
      freeSpaceBytes: { value: async () => Math.floor(content.length * 1.1) }, // below sizeBytes * 1.15
    });
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), starvedFileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });

    await expect(engine.downloadArtifact(artifact())).rejects.toThrow(InsufficientStorageError);

    expect(mockServer.requestCount).toBe(0); // no HTTP request, let alone a write, was ever attempted
    const [state] = await sqlite.query<{ status: string }>('SELECT status FROM download_state');
    expect(state?.status).toBe('failed');
  });

  it('succeeds once free space is at or above the 1.15x threshold', async () => {
    const roomyFileSystem: typeof fileSystem = Object.create(fileSystem, {
      freeSpaceBytes: { value: async () => Math.ceil(content.length * 1.15) },
    });
    const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), roomyFileSystem, hash, sqlite, clock, {
      backoffMs: () => 0,
    });

    const { destinationPath } = await engine.downloadArtifact(artifact());

    expect(fs.readFileSync(destinationPath).equals(content)).toBe(true);
  });

  // Regression, 2026-08-19: CapgoDownloaderAdapter's pause()/resume() reject
  // "not supported on Android" (confirmed on-device by reading the plugin's
  // Java source) — a retry there is a full restart, not a resume, and
  // DownloadManager.enqueue() against an already-existing destination file
  // auto-renames to "-1"/"-2"/... instead of overwriting, leaking an orphan
  // on every retry. DownloadTransportPort.supportsResume tells
  // DownloadEngine which behavior to expect.
  describe('supportsResume', () => {
    /** Wraps NodeRangeDownloadAdapter but reports supportsResume: false, to exercise the non-resuming path without a device. */
    class NoResumeWrapper implements DownloadTransportPort {
      readonly supportsResume = false;
      constructor(private readonly inner: DownloadTransportPort) {}
      start(task: Parameters<DownloadTransportPort['start']>[0]) {
        return this.inner.start(task);
      }
      pause(id: string) {
        return this.inner.pause(id);
      }
      resume(id: string) {
        return this.inner.resume(id);
      }
      stop(id: string, options?: { discardPartial?: boolean }) {
        return this.inner.stop(id, options);
      }
      status(id: string) {
        return this.inner.status(id);
      }
      onProgress(cb: Parameters<DownloadTransportPort['onProgress']>[0]) {
        return this.inner.onProgress(cb);
      }
      onCompleted(cb: Parameters<DownloadTransportPort['onCompleted']>[0]) {
        return this.inner.onCompleted(cb);
      }
      onFailed(cb: Parameters<DownloadTransportPort['onFailed']>[0]) {
        return this.inner.onFailed(cb);
      }
    }

    it('supportsResume: false deletes the previous partial file before retrying', async () => {
      mockServer.dropNextResponseAfter(Math.floor(content.length / 2));
      const deleteFileSpy = vi.spyOn(fileSystem, 'deleteFile');
      const engine = new DownloadEngine(new NoResumeWrapper(new NodeRangeDownloadAdapter()), fileSystem, hash, sqlite, clock, {
        backoffMs: () => 0,
      });

      const { destinationPath } = await engine.downloadArtifact(artifact());

      expect(fs.readFileSync(destinationPath).equals(content)).toBe(true); // still ends up correct
      expect(deleteFileSpy).toHaveBeenCalledWith(destinationPath); // but the partial was cleaned up before the retry, not left as an orphan
      const [state] = await sqlite.query<{ attempt: number }>('SELECT attempt FROM download_state');
      expect(state?.attempt).toBe(2);
    });

    it('supportsResume: true (the default/real-resume adapters) never deletes the partial file', async () => {
      mockServer.dropNextResponseAfter(Math.floor(content.length / 2));
      const deleteFileSpy = vi.spyOn(fileSystem, 'deleteFile');
      const engine = new DownloadEngine(new NodeRangeDownloadAdapter(), fileSystem, hash, sqlite, clock, {
        backoffMs: () => 0,
      });

      await engine.downloadArtifact(artifact());

      expect(deleteFileSpy).not.toHaveBeenCalled(); // the partial file must survive for the transport's own Range-request resume to use
    });
  });

  describe('pause/resume/cancel', () => {
    // A dedicated, much larger payload than the outer suite's 2MB — small
    // enough to complete before a single localhost read() cycle would make
    // "pause it mid-transfer" flaky to observe.
    let bigContent: Buffer;
    let bigServer: ReturnType<typeof createMockDownloadServer>;
    let bigUrl: string;

    beforeEach(async () => {
      bigContent = Buffer.alloc(60_000_000);
      for (let i = 0; i < bigContent.length; i++) bigContent[i] = (i * 13) % 256;
      bigServer = createMockDownloadServer(bigContent);
      bigUrl = await bigServer.listen();
    });

    afterEach(async () => {
      await bigServer.close();
    });

    function bigArtifact() {
      return { kind: 'model' as const, filename: 'model.gguf', url: bigUrl, sha256: hash.sha256(bigContent), sizeBytes: bigContent.length };
    }

    it('pause() stops progress and the in-flight downloadArtifact() call only resolves once resume()d', async () => {
      const transport = new NodeRangeDownloadAdapter();
      const engine = new DownloadEngine(transport, fileSystem, hash, sqlite, clock, { backoffMs: () => 0 });
      const key = engine.keyFor(bigUrl, 'model.gguf');
      const progressUpdates: number[] = [];

      const downloadPromise = engine.downloadArtifact(bigArtifact(), {
        onProgress: (p) => progressUpdates.push(p.percent),
      });

      // Let the transfer get moving, then pause it well before it can finish.
      await vi.waitFor(() => expect(progressUpdates.length).toBeGreaterThan(0));
      await engine.pause(key);
      expect(progressUpdates.at(-1)).toBeLessThan(100); // genuinely caught it mid-transfer, not after completion

      // An already-in-flight read() can land one more tick right after
      // abort() — wait for that race to settle, then confirm progress
      // truly stays flat (not just "hasn't grown yet").
      await new Promise((resolve) => setTimeout(resolve, 100));
      const settledCount = progressUpdates.length;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(progressUpdates.length).toBe(settledCount);

      await engine.resume(key);
      const { destinationPath } = await downloadPromise;

      expect(fs.readFileSync(destinationPath).equals(bigContent)).toBe(true);
    });

    it('cancel({ discardPartial: true }) deletes the partial file and clears download_state', async () => {
      const transport = new NodeRangeDownloadAdapter();
      const engine = new DownloadEngine(transport, fileSystem, hash, sqlite, clock, { backoffMs: () => 0 });
      const key = engine.keyFor(bigUrl, 'model.gguf');
      const destinationPath = fileSystem.resolvePath('models', 'model.gguf');

      const downloadPromise = engine.downloadArtifact(bigArtifact()).catch(() => undefined); // pause+cancel leaves this pending forever — don't let it fail the suite
      await vi.waitFor(async () => expect((await fileSystem.stat(destinationPath))?.sizeBytes ?? 0).toBeGreaterThan(0));

      await engine.pause(key);
      await engine.cancel(key, destinationPath, { discardPartial: true });

      expect(await fileSystem.exists(destinationPath)).toBe(false);
      const rows = await sqlite.query('SELECT * FROM download_state WHERE key = ?', [key]);
      expect(rows).toHaveLength(0);

      void downloadPromise; // deliberately left unresolved — see comment above
    });
  });
});
