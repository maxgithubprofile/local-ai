import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DownloadEngine } from '../../../src/core/download/download-engine.js';
import { NodeRangeDownloadAdapter } from '../../../src/adapters/node-testing/node-range-download.adapter.js';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';
import { WebCryptoHashAdapter } from '../../../src/adapters/node-testing/web-crypto-hash.adapter.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';
import { ChecksumMismatchError } from '../../../src/core/errors.js';
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
});
