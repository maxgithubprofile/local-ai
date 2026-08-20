import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalAiClient } from '../../../src/core/client/local-ai-client.js';
import type { LocalAiPorts } from '../../../src/core/ports/index.js';
import type { FileSystemPort } from '../../../src/core/ports/filesystem.port.js';
import { FakePlatformSupportAdapter } from '../../../src/adapters/node-testing/fake-platform-support.adapter.js';
import { FakeDeviceInfoAdapter } from '../../../src/adapters/node-testing/fake-device-info.adapter.js';
import { FakeLlmRuntimeAdapter } from '../../../src/adapters/node-testing/fake-llm-runtime.adapter.js';
import { FakeAppLifecycleAdapter } from '../../../src/adapters/node-testing/fake-app-lifecycle.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { NodeRangeDownloadAdapter } from '../../../src/adapters/node-testing/node-range-download.adapter.js';
import { WebCryptoHashAdapter } from '../../../src/adapters/shared/web-crypto-hash.adapter.js';
import { createMockDownloadServer } from '../download/mock-http-server.js';
import {
  ChecksumMismatchError,
  ConfigInvalidError,
  DeviceNotEligibleError,
  MessageNotFoundError,
  RuntimeInitError,
} from '../../../src/core/errors.js';
import type { DeviceSnapshot } from '../../../src/core/support/types.js';

const realFetch = globalThis.fetch;
const hash = new WebCryptoHashAdapter();
const MODEL_BYTES = Buffer.from('fake-model-weights-content');

function manifestBody() {
  return {
    manifestVersion: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    model: {
      id: 'qwen-4b',
      version: 1,
      displayName: 'Qwen 4B',
      family: 'qwen',
      paramsB: 4,
      quant: 'Q4_K_M',
      languages: 'multilingual',
      contextLength: 2048,
      source: { type: 'huggingface', repo: 'org/qwen', revision: 'abc123def456', file: 'model.gguf' },
      filename: 'model.gguf',
      sha256: hash.sha256(MODEL_BYTES),
      sizeBytes: MODEL_BYTES.length,
      minRamGb: 4,
      recommendedRamGb: 8,
      chatTemplate: 'auto' as const,
      status: 'active' as const,
    },
    embedding: {
      id: 'bge-small',
      version: 1,
      compatibleModelIds: ['qwen-4b'],
      dimensions: 4,
      source: { type: 'url', url: 'https://example.com/embedding.gguf' },
      filename: 'embedding.gguf',
      // Both "model" and "embedding" downloads route to the same mock
      // server/content in this test (see the fetch stub below) — the sha256
      // here must match what's actually served (MODEL_BYTES), not a
      // separate EMBEDDING_BYTES that's never served.
      sha256: hash.sha256(MODEL_BYTES),
      sizeBytes: MODEL_BYTES.length,
      minRamGb: 1,
      recommendedRamGb: 2,
      status: 'active' as const,
    },
  };
}

const goodDevice: DeviceSnapshot = {
  totalRamGb: 8,
  freeRamGb: 6,
  freeDiskBytes: 10_000_000_000,
  thermal: 'nominal',
  lowPowerMode: false,
};

describe('LocalAiClient', () => {
  let tmpDir: string;
  let modelServer: ReturnType<typeof createMockDownloadServer>;
  let modelUrl: string;
  let deviceInfo: FakeDeviceInfoAdapter;
  let llmRuntime: FakeLlmRuntimeAdapter;
  let ports: LocalAiPorts;
  let manifestUrl: string;
  const extraServers: Array<ReturnType<typeof createMockDownloadServer>> = [];

  /**
   * Re-stubs `fetch` to serve `body` for `manifestUrl` and route any
   * huggingface.co/`body.embedding.source.url` request to `defaultRouteUrl`
   * (the always-on `modelServer` by default), with per-URL overrides for
   * tests that need the model/embedding to resolve to *different* mock
   * servers (e.g. `switchModel()`'s "new version, different bytes").
   */
  function stubManifest(body: ReturnType<typeof manifestBody>, routeOverrides: Record<string, string> = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === manifestUrl) {
          return new Response(JSON.stringify(body), { status: 200 });
        }
        if (url in routeOverrides) {
          return realFetch(routeOverrides[url]!, init);
        }
        if (url.includes('huggingface.co') || url === body.embedding.source.url) {
          return realFetch(modelUrl, init);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-client-'));
    modelServer = createMockDownloadServer(MODEL_BYTES);
    modelUrl = await modelServer.listen();
    manifestUrl = 'https://example.com/manifest.json';
    stubManifest(manifestBody());

    deviceInfo = new FakeDeviceInfoAdapter(goodDevice);
    llmRuntime = new FakeLlmRuntimeAdapter();
    ports = {
      platformSupport: new FakePlatformSupportAdapter({
        platform: 'android',
        isNative: true,
        availablePlugins: ['LlamaCpp', 'CapacitorSQLite', 'CapacitorDownloader', 'DeviceInfo'],
      }),
      deviceInfo,
      downloadTransport: new NodeRangeDownloadAdapter(),
      fileSystem: new NodeFsAdapter(tmpDir),
      sqlite: new NodeSqliteAdapter(':memory:'),
      llmRuntime,
      clock: new FakeClockAdapter(),
      hash,
      appLifecycle: new FakeAppLifecycleAdapter(),
    };
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await modelServer.close();
    await Promise.all(extraServers.map((s) => s.close()));
    extraServers.length = 0;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('create() throws ConfigInvalidError when ports are incomplete', async () => {
    await expect(
      LocalAiClient.create({ manifestUrl, ports: { platformSupport: ports.platformSupport } }),
    ).rejects.toThrow(ConfigInvalidError);
  });

  it('create() throws ConfigInvalidError for a non-https:// manifestUrl (SEC.2)', async () => {
    await expect(LocalAiClient.create({ manifestUrl: 'http://example.com/manifest.json', ports })).rejects.toThrow(
      ConfigInvalidError,
    );
  });

  it('checkSupport() reports inference available with every plugin present', async () => {
    const report = await LocalAiClient.checkSupport({ platformSupport: ports.platformSupport });
    expect(report.capabilities.inference).toBe(true);
  });

  it('full happy path: refreshManifest -> ensureReady -> complete -> embed', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });

    const diff = await client.refreshManifest();
    expect(diff.modelChanged).toBe(true);
    expect(diff.embeddingChanged).toBe(true);

    await client.ensureModelReady();
    await client.ensureEmbeddingReady();
    expect(llmRuntime.modelLoaded).toBe(true);
    expect(llmRuntime.embeddingModelLoaded).toBe(true);

    llmRuntime.scriptedTokens = ['Hello', ', ', 'world!'];
    const stream = client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const chunks: string[] = [];
    for await (const t of stream) chunks.push(t.token);
    const result = await stream.result;
    expect(result.content).toBe('Hello, world!');
    expect(chunks.join('')).toBe('Hello, world!');

    const embedding = await client.embed('some text');
    expect(embedding).toBeInstanceOf(Float32Array);
  });

  // Regression: once the download+verify pipeline finished (status:
  // 'completed'), ensureModelReady() went silent for the entire
  // llmRuntime.loadModel() call — no distinct signal that a real,
  // separate (and non-trivial, for a GB-scale GGUF) phase was in
  // progress. A UI watching only 'completed'/percent could not tell
  // "verified, about to load" apart from "still stuck at 100%"
  // (reported live 2026-08-19: "скачалась модель - зависла на 100%").
  it("ensureModelReady() emits a status: 'loading' progress event before calling llmRuntime.loadModel()", async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    const statuses: string[] = [];
    let modelLoadedWhenLoadingEventFired: boolean | undefined;

    await client.ensureModelReady({
      onProgress: (p) => {
        statuses.push(p.status);
        if (p.status === 'loading') modelLoadedWhenLoadingEventFired = llmRuntime.modelLoaded;
      },
    });

    expect(statuses).toContain('loading');
    expect(statuses.indexOf('completed')).toBeLessThan(statuses.lastIndexOf('loading')); // download+verify pipeline was already done
    expect(modelLoadedWhenLoadingEventFired).toBe(false); // fired BEFORE loadModel() actually ran, not after
    expect(llmRuntime.modelLoaded).toBe(true); // and loadModel() did still run
  });

  it("ensureModelReady() does NOT emit 'loading' again on a no-op call once the model is already loaded", async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();

    const statuses: string[] = [];
    await client.ensureModelReady({ onProgress: (p) => statuses.push(p.status) });

    expect(statuses).not.toContain('loading');
  });

  // Regression for the 2026-08-19 live bug: loadModel()/loadEmbeddingModel()
  // were being handed FileSystemPort.resolvePath()'s output directly — a
  // path relative to the port's own Directory.Data convention, which the
  // native llama.cpp binding behind LlmRuntimePort has no way to resolve.
  // NodeFsAdapter's toAbsolutePath() is a same-value no-op (see its own
  // test), so this wraps it to prove LocalAiClient actually calls
  // toAbsolutePath() and forwards *its* result, rather than the raw
  // destinationPath, to the runtime.
  it('ensureModelReady()/ensureEmbeddingReady() pass loadModel()/loadEmbeddingModel() the fileSystem.toAbsolutePath()-resolved path, not the raw relative one', async () => {
    const rawPathsSeen: string[] = [];
    const realFs = ports.fileSystem;
    // Explicit method-by-method delegation, not `{ ...realFs }` — a class
    // instance's methods live on its prototype, not as own-enumerable
    // properties, so a plain object spread would silently drop all of them.
    const wrappedFs: FileSystemPort = {
      exists: (p) => realFs.exists(p),
      mkdir: (p, o) => realFs.mkdir(p, o),
      writeFile: (p, d) => realFs.writeFile(p, d),
      appendFile: (p, d) => realFs.appendFile(p, d),
      readFile: (p) => realFs.readFile(p),
      readChunks: (p, c) => realFs.readChunks(p, c),
      deleteFile: (p) => realFs.deleteFile(p),
      listFiles: (p) => realFs.listFiles(p),
      stat: (p) => realFs.stat(p),
      resolvePath: (...s) => realFs.resolvePath(...s),
      freeSpaceBytes: (p) => realFs.freeSpaceBytes(p),
      toAbsolutePath: async (p) => {
        rawPathsSeen.push(p);
        const real = await realFs.toAbsolutePath(p);
        return `RESOLVED::${real}`;
      },
    };
    const client = await LocalAiClient.create({ manifestUrl, ports: { ...ports, fileSystem: wrappedFs } });
    await client.refreshManifest();

    await client.ensureModelReady();
    await client.ensureEmbeddingReady();

    expect(llmRuntime.loadModelCalls).toHaveLength(1);
    expect(llmRuntime.loadModelCalls[0]!.modelPath).toMatch(/^RESOLVED::/);
    expect(llmRuntime.loadEmbeddingModelCalls).toHaveLength(1);
    expect(llmRuntime.loadEmbeddingModelCalls[0]!.modelPath).toMatch(/^RESOLVED::/);
    // and toAbsolutePath() itself was handed exactly resolvePath()'s own output — not a re-derived path
    expect(rawPathsSeen).toContain(ports.fileSystem.resolvePath('models', 'model.gguf'));
    expect(rawPathsSeen).toContain(ports.fileSystem.resolvePath('embeddings', 'embedding.gguf'));
  });

  // perf-tuning plan §3 (docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md):
  // config.runtimeTuning.threads must reach llmRuntime.loadModel() unchanged,
  // and stay entirely absent (undefined, not e.g. coerced to 0) when unset —
  // preserving the native runtime's own default for any consumer that
  // doesn't configure it.
  describe('runtimeTuning.threads (perf-tuning plan §3)', () => {
    it('forwards config.runtimeTuning.threads to llmRuntime.loadModel()', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports, runtimeTuning: { threads: 4 } });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.threads).toBe(4);
    });

    it('leaves threads undefined when runtimeTuning is not configured at all', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.threads).toBeUndefined();
    });

    it('forwards the new runtimeTuning.threads to loadModel() again on switchModel() (independent reload call site)', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports, runtimeTuning: { threads: 2 } });
      await client.refreshManifest();
      await client.ensureModelReady();

      await client.switchModel();

      expect(llmRuntime.loadModelCalls).toHaveLength(2);
      expect(llmRuntime.loadModelCalls[1]!.threads).toBe(2);
    });
  });

  // perf-tuning plan §5 (docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md):
  // same plumbing as §3's threads test above, for config.runtimeTuning.batchSize/
  // ubatchSize — forta.chat deliberately leaves these unset for now (plan §5),
  // this only verifies the infrastructure carries them through when a consumer
  // does set them.
  describe('runtimeTuning.batchSize/ubatchSize (perf-tuning plan §5)', () => {
    it('forwards config.runtimeTuning.batchSize/ubatchSize to llmRuntime.loadModel()', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports, runtimeTuning: { batchSize: 256, ubatchSize: 128 } });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.batchSize).toBe(256);
      expect(llmRuntime.loadModelCalls[0]!.ubatchSize).toBe(128);
    });

    it('leaves batchSize/ubatchSize undefined when runtimeTuning is not configured at all', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.batchSize).toBeUndefined();
      expect(llmRuntime.loadModelCalls[0]!.ubatchSize).toBeUndefined();
    });

    it('forwards the new runtimeTuning.batchSize/ubatchSize to loadModel() again on switchModel() (independent reload call site)', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports, runtimeTuning: { batchSize: 512, ubatchSize: 256 } });
      await client.refreshManifest();
      await client.ensureModelReady();

      await client.switchModel();

      expect(llmRuntime.loadModelCalls).toHaveLength(2);
      expect(llmRuntime.loadModelCalls[1]!.batchSize).toBe(512);
      expect(llmRuntime.loadModelCalls[1]!.ubatchSize).toBe(256);
    });
  });

  // perf-tuning plan §6 (docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md):
  // same additive plumbing as §3/§5's threads/batchSize/ubatchSize tests
  // above, plus resolveRuntimeTuning()'s own guard — kvCacheQuant without
  // flashAttention: true is dropped before loadModel(), not thrown.
  describe('runtimeTuning.flashAttention/kvCacheQuant (perf-tuning plan §6)', () => {
    it('forwards config.runtimeTuning.flashAttention/kvCacheQuant to llmRuntime.loadModel() when paired correctly', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports, runtimeTuning: { flashAttention: true, kvCacheQuant: 'q8_0' } });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.flashAttention).toBe(true);
      expect(llmRuntime.loadModelCalls[0]!.kvCacheQuant).toBe('q8_0');
    });

    it('leaves flashAttention/kvCacheQuant undefined when runtimeTuning is not configured at all', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.flashAttention).toBeUndefined();
      expect(llmRuntime.loadModelCalls[0]!.kvCacheQuant).toBeUndefined();
    });

    it('drops kvCacheQuant (warn-logged, not thrown) when flashAttention is not also set', async () => {
      // Not toHaveBeenCalledTimes(1) — boot-time self-tests (sqlite-vec/FTS5
      // fallback checks) also log through the same config.logger.warn and
      // are unrelated to this guard; match on message content instead.
      const warn = vi.fn();
      const client = await LocalAiClient.create({
        manifestUrl,
        ports,
        runtimeTuning: { kvCacheQuant: 'q4_0' },
        logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
      });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls).toHaveLength(1);
      expect(llmRuntime.loadModelCalls[0]!.kvCacheQuant).toBeUndefined();
      expect(llmRuntime.loadModelCalls[0]!.flashAttention).toBeUndefined();
      const kvCacheWarning = warn.mock.calls.find((call) => /kvCacheQuant.*flashAttention/.test(String(call[0])));
      expect(kvCacheWarning).toBeDefined();
    });

    it('does not warn about kvCacheQuant/flashAttention when they are paired correctly', async () => {
      const warn = vi.fn();
      const client = await LocalAiClient.create({
        manifestUrl,
        ports,
        runtimeTuning: { flashAttention: true, kvCacheQuant: 'q4_0' },
        logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
      });
      await client.refreshManifest();

      await client.ensureModelReady();

      expect(llmRuntime.loadModelCalls[0]!.kvCacheQuant).toBe('q4_0');
      const kvCacheWarning = warn.mock.calls.find((call) => /kvCacheQuant.*flashAttention/.test(String(call[0])));
      expect(kvCacheWarning).toBeUndefined();
    });

    it('forwards the new runtimeTuning.flashAttention/kvCacheQuant to loadModel() again on switchModel() (independent reload call site)', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports, runtimeTuning: { flashAttention: true, kvCacheQuant: 'f16' } });
      await client.refreshManifest();
      await client.ensureModelReady();

      await client.switchModel();

      expect(llmRuntime.loadModelCalls).toHaveLength(2);
      expect(llmRuntime.loadModelCalls[1]!.flashAttention).toBe(true);
      expect(llmRuntime.loadModelCalls[1]!.kvCacheQuant).toBe('f16');
    });
  });

  // perf-tuning plan §7 (docs/plans/llama2/2026-08-20-local-ai-perf-tuning-plan.md):
  // ensureModelReady() fires a best-effort, non-awaited bench() after a
  // fresh load and records 'tooSlow' when tgAvg is under the threshold —
  // closing the gap where bench()/recordVerdict() existed but nothing ever
  // called them together (§1). All assertions poll via vi.waitFor() because
  // the producing call is deliberately fire-and-forget, not awaited by
  // ensureModelReady() itself.
  describe('bench() → tooSlow verdict (perf-tuning plan §7)', () => {
    it('does not record a tooSlow verdict when bench() tgAvg is above the threshold', async () => {
      llmRuntime.scriptedBenchTgAvg = 10; // default tooSlowTokPerSec is 3
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      await client.ensureModelReady();
      await new Promise((resolve) => setTimeout(resolve, 20)); // let the fire-and-forget bench()+recordVerdict() (real sqlite I/O) settle either way

      const report = await client.checkDeviceEligibility('model');
      expect(report.verdict).toBe('ok'); // unaffected — no verdict was ever persisted
    });

    it('records a tooSlow verdict, visible on the next checkDeviceEligibility() as "tight", when bench() tgAvg is below the threshold', async () => {
      llmRuntime.scriptedBenchTgAvg = 1; // below default tooSlowTokPerSec (3)
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      await client.ensureModelReady();
      await vi.waitFor(async () => {
        const report = await client.checkDeviceEligibility('model');
        expect(report.verdict).toBe('tight');
      });
    });

    it('respects a configured tooSlowTokPerSec instead of the default 3', async () => {
      llmRuntime.scriptedBenchTgAvg = 4; // above default 3, below a custom 5
      const client = await LocalAiClient.create({ manifestUrl, ports, tooSlowTokPerSec: 5 });
      await client.refreshManifest();

      await client.ensureModelReady();
      await vi.waitFor(async () => {
        const report = await client.checkDeviceEligibility('model');
        expect(report.verdict).toBe('tight');
      });
    });

    it('does not reject ensureModelReady() when bench() itself throws (best-effort, TZ-style soft dependency)', async () => {
      llmRuntime.bench = async () => {
        throw new Error('native bench() crashed');
      };
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      await expect(client.ensureModelReady()).resolves.toBeUndefined();
    });
  });

  // getDownloadProgress() — added 2026-08-19 so a consumer can show "resume
  // from X%" before the user taps download, rather than only finding out
  // once ensureModelReady() is already moving (docs/decisions.md's
  // "no real resume on Android" entry — forta.chat's UI request that
  // prompted this).
  describe('getDownloadProgress()', () => {
    it('resolves null before any manifest has ever been fetched/cached', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });

      expect(await client.getDownloadProgress()).toBeNull();
    });

    it('resolves null once the manifest is cached but no partial file exists on disk yet', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();

      expect(await client.getDownloadProgress()).toBeNull();
    });

    it('reports bytes/percent from a partial file already on disk, without starting a download', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();
      const partialBytes = Math.floor(MODEL_BYTES.length / 2);
      await ports.fileSystem.writeFile(
        ports.fileSystem.resolvePath('models', 'model.gguf'),
        MODEL_BYTES.subarray(0, partialBytes),
      );

      const progress = await client.getDownloadProgress();

      expect(progress).toEqual({
        bytesDownloaded: partialBytes,
        sizeBytesExpected: MODEL_BYTES.length,
        percent: Math.round((partialBytes / MODEL_BYTES.length) * 100),
      });
      // Reading it didn't touch the transport/attempt anything — no download_state row was created.
      expect(llmRuntime.modelLoaded).toBe(false);
    });

    it('reports the embedding artifact when called with target: "embedding"', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();
      await ports.fileSystem.writeFile(ports.fileSystem.resolvePath('embeddings', 'embedding.gguf'), MODEL_BYTES);

      expect(await client.getDownloadProgress('embedding')).toEqual({
        bytesDownloaded: MODEL_BYTES.length,
        sizeBytesExpected: MODEL_BYTES.length,
        percent: 100,
      });
    });
  });

  // pauseModelDownload()/resumeModelDownload()/deleteModel() — added
  // 2026-08-19 for forta.chat's Settings → Local AI pause/resume/delete
  // buttons (docs/decisions.md).
  describe('pauseModelDownload()/resumeModelDownload()/deleteModel()', () => {
    it('is a no-op when no manifest is cached yet', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await expect(client.pauseModelDownload()).resolves.toBeUndefined();
      await expect(client.resumeModelDownload()).resolves.toBeUndefined();
      await expect(client.deleteModel()).resolves.toBeUndefined();
    });

    it('pauseModelDownload() stalls an in-flight ensureModelReady() until resumeModelDownload() is called', async () => {
      // MODEL_BYTES (~27 bytes) would finish in a single read() cycle,
      // before pause() could ever land mid-transfer — a dedicated, much
      // larger payload here so there's genuinely something to pause.
      const bigBytes = Buffer.alloc(60_000_000);
      for (let i = 0; i < bigBytes.length; i++) bigBytes[i] = (i * 13) % 256;
      const bigServer = createMockDownloadServer(bigBytes);
      extraServers.push(bigServer);
      const bigUrl = await bigServer.listen();

      const body = manifestBody();
      body.model.sha256 = hash.sha256(bigBytes);
      body.model.sizeBytes = bigBytes.length;
      stubManifest(body, { 'https://huggingface.co/org/qwen/resolve/abc123def456/model.gguf': bigUrl });

      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();
      const progressUpdates: number[] = [];

      const ready = client.ensureModelReady({ onProgress: (p) => progressUpdates.push(p.percent) });
      await vi.waitFor(() => expect(progressUpdates.length).toBeGreaterThan(0));

      await client.pauseModelDownload();
      expect(progressUpdates.at(-1)).toBeLessThan(100); // genuinely caught it mid-transfer, not after completion

      // An already-in-flight read() can land one more tick right after
      // abort() — wait for that race to settle, then confirm progress
      // truly stays flat (not just "hasn't grown yet").
      await new Promise((resolve) => setTimeout(resolve, 100));
      const settledCount = progressUpdates.length;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(progressUpdates.length).toBe(settledCount); // still stalled — no further progress while paused
      expect(llmRuntime.modelLoaded).toBe(false);

      await client.resumeModelDownload();
      await ready;

      expect(llmRuntime.modelLoaded).toBe(true);
    });

    it('deleteModel() removes the downloaded file, unloads the runtime, and clears the registry so a later ensureModelReady() re-downloads', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();
      await client.ensureModelReady();
      expect(llmRuntime.modelLoaded).toBe(true);

      await client.deleteModel();

      expect(llmRuntime.modelLoaded).toBe(false);
      expect(await ports.fileSystem.exists(ports.fileSystem.resolvePath('models', 'model.gguf'))).toBe(false);
      expect(await client.getDownloadProgress()).toBeNull();

      // Re-downloads cleanly rather than short-circuiting on stale state.
      await client.ensureModelReady();
      expect(llmRuntime.modelLoaded).toBe(true);
    });

    it('deleteModel() with only a partial (never-completed) download discards it without touching the runtime', async () => {
      const client = await LocalAiClient.create({ manifestUrl, ports });
      await client.refreshManifest();
      await ports.fileSystem.writeFile(
        ports.fileSystem.resolvePath('models', 'model.gguf'),
        MODEL_BYTES.subarray(0, Math.floor(MODEL_BYTES.length / 2)),
      );

      await expect(client.deleteModel()).resolves.toBeUndefined();

      expect(llmRuntime.modelLoaded).toBe(false);
      expect(await ports.fileSystem.exists(ports.fileSystem.resolvePath('models', 'model.gguf'))).toBe(false);
    });
  });

  it('complete() before ensureModelReady() rejects via stream.result, not a throw', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    const stream = client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await expect(stream.result).rejects.toThrow('ensureModelReady');
    const tokens: unknown[] = [];
    for await (const t of stream) tokens.push(t);
    expect(tokens).toEqual([]);
  });

  it('ensureModelReady() throws DeviceNotEligibleError by default when the device is under minRamGb', async () => {
    deviceInfo.set({ ...goodDevice, totalRamGb: 2, freeRamGb: 1 });
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();

    await expect(client.ensureModelReady()).rejects.toThrow(DeviceNotEligibleError);
    expect(llmRuntime.modelLoaded).toBe(false);
  });

  it("ensureModelReady() with eligibilityPolicy.no = 'warn' continues and emits device:eligibility-warning", async () => {
    deviceInfo.set({ ...goodDevice, totalRamGb: 2, freeRamGb: 1 });
    const client = await LocalAiClient.create({ manifestUrl, ports, eligibilityPolicy: { no: 'warn' } });
    await client.refreshManifest();

    let warned = false;
    client.on('device:eligibility-warning', () => {
      warned = true;
    });
    await client.ensureModelReady();

    expect(warned).toBe(true);
    expect(llmRuntime.modelLoaded).toBe(true);
  });

  it('ConversationApi CRUD (Mode A) works end to end through LocalAiClient', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });

    const created = await client.createChat({ title: 'Trip' });
    expect((await client.getChat(created.id))?.title).toBe('Trip');

    await client.renameChat(created.id, 'Trip planning');
    expect((await client.getChat(created.id))?.title).toBe('Trip planning');

    const chats = await client.listChats();
    expect(chats.map((c) => c.id)).toContain(created.id);

    await client.deleteChat(created.id);
    expect(await client.getChat(created.id)).toBeNull();
  });

  it('refreshManifest() on a validation failure emits manifest:invalid and keeps serving the prior cache', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest(); // caches a valid manifest first

    const invalidBody = manifestBody();
    invalidBody.model.source.revision = 'main';
    stubManifest(invalidBody);

    let invalidEventFired = false;
    client.on('manifest:invalid', () => {
      invalidEventFired = true;
    });

    const diff = await client.refreshManifest();
    expect(invalidEventFired).toBe(true);
    expect(diff.modelChanged).toBe(false); // still the previously cached manifest, reported as unchanged
  });

  // --- sendMessage() — TZ §9.3/§9.4/§9.7/§9.8 ---

  it('sendMessage() saves both messages and returns the assistant reply with status "complete"', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chat = await client.createChat();

    llmRuntime.scriptedTokens = ['Ahoy', ', ', 'matey!'];
    const stream = client.sendMessage(chat.id, 'hello there');
    const chunks: string[] = [];
    for await (const t of stream) chunks.push(t.token);
    const assistantMessage = await stream.result;

    expect(assistantMessage.status).toBe('complete');
    expect(assistantMessage.content).toBe('Ahoy, matey!');
    expect(chunks.join('')).toBe('Ahoy, matey!');

    const messages = await client.getMessages(chat.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.content).toBe('hello there');
    expect(messages[0]?.status).toBe('complete');
    expect(messages[1]?.content).toBe('Ahoy, matey!');
  });

  it('sendMessage() saves the user message even though generation never starts (RuntimeBusyError)', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chatA = await client.createChat();
    const chatB = await client.createChat();

    llmRuntime.scriptedOutcome = 'hang';
    const controllerA = new AbortController();
    const first = client.sendMessage(chatA.id, 'first chat message', { signal: controllerA.signal });

    const second = client.sendMessage(chatB.id, 'second chat message, different chat');
    await expect(second.result).rejects.toMatchObject({ code: 'runtime_busy' });

    const chatBMessages = await client.getMessages(chatB.id);
    expect(chatBMessages).toHaveLength(1); // user message survived even though the assistant reply never happened
    expect(chatBMessages[0]?.role).toBe('user');

    controllerA.abort();
    await first.result;
  });

  it('sendMessage() with an AbortSignal saves the assistant message as "cancelled" with partial content', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chat = await client.createChat();

    llmRuntime.scriptedTokens = ['a', 'b', 'c', 'd', 'e'];
    const controller = new AbortController();
    const stream = client.sendMessage(chat.id, 'hi', { signal: controller.signal });

    let seen = 0;
    for await (const token of stream) {
      seen += 1;
      if (token && seen === 2) controller.abort();
    }
    const assistantMessage = await stream.result;

    expect(assistantMessage.status).toBe('cancelled');
    expect(assistantMessage.content.length).toBeGreaterThan(0);
    expect(assistantMessage.content.length).toBeLessThan('abcde'.length);

    const saved = await client.getMessages(chat.id);
    expect(saved[1]?.status).toBe('cancelled');
  });

  it('sendMessage() on a runtime error saves the assistant message as "error"', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chat = await client.createChat();

    llmRuntime.scriptedOutcome = 'error';
    const stream = client.sendMessage(chat.id, 'hi');
    const assistantMessage = await stream.result;

    expect(assistantMessage.status).toBe('error');
    const saved = await client.getMessages(chat.id);
    expect(saved[1]?.status).toBe('error');
  });

  // --- switchModel() / switchEmbedding() — TZ §5.5/§5.6 ---

  it('switchModel() downloads the new file, releases only the LLM context, deletes the old file, invalidates sessions, and reloads', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    await client.ensureEmbeddingReady();

    const oldModelPath = path.join(tmpDir, 'models', 'model.gguf');
    expect(fs.existsSync(oldModelPath)).toBe(true);

    const NEW_MODEL_BYTES = Buffer.from('fake-model-weights-v2-content');
    const newModelServer = createMockDownloadServer(NEW_MODEL_BYTES);
    extraServers.push(newModelServer);
    const newModelUrl = await newModelServer.listen();

    const v2Body = manifestBody();
    v2Body.model.version = 2;
    v2Body.model.filename = 'model-v2.gguf';
    v2Body.model.sha256 = hash.sha256(NEW_MODEL_BYTES);
    v2Body.model.sizeBytes = NEW_MODEL_BYTES.length;
    stubManifest(v2Body, { 'https://huggingface.co/org/qwen/resolve/abc123def456/model.gguf': newModelUrl });

    await client.refreshManifest();

    let unloadedReason: string | undefined;
    client.on('runtime:unloaded', (e) => {
      unloadedReason = e.reason;
    });

    await client.switchModel();

    expect(unloadedReason).toBe('model-switch');
    expect(fs.existsSync(oldModelPath)).toBe(false); // old file deleted (TZ §5.5 step 6)
    expect(fs.existsSync(path.join(tmpDir, 'models', 'model-v2.gguf'))).toBe(true);
    expect(llmRuntime.modelLoaded).toBe(true); // reloaded with the new weights
    expect(llmRuntime.embeddingModelLoaded).toBe(true); // untouched (TZ §5.5 step 4 — LLM context only)
  });

  it('switchEmbedding() emits vector-store:embedding-changed with dimensionsChanged and leaves the model untouched', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    await client.ensureEmbeddingReady();

    const NEW_EMBEDDING_BYTES = Buffer.from('fake-embedding-weights-v2-content');
    const newEmbeddingServer = createMockDownloadServer(NEW_EMBEDDING_BYTES);
    extraServers.push(newEmbeddingServer);
    const newEmbeddingUrl = await newEmbeddingServer.listen();

    const v2Body = manifestBody();
    v2Body.embedding.version = 2;
    v2Body.embedding.filename = 'embedding-v2.gguf';
    v2Body.embedding.dimensions = 8; // was 4
    v2Body.embedding.sha256 = hash.sha256(NEW_EMBEDDING_BYTES);
    v2Body.embedding.sizeBytes = NEW_EMBEDDING_BYTES.length;
    stubManifest(v2Body, { 'https://example.com/embedding.gguf': newEmbeddingUrl });

    await client.refreshManifest();

    let event: { dimensionsChanged: boolean; current: { dimensions: number } } | undefined;
    client.on('vector-store:embedding-changed', (e) => {
      event = e;
    });

    await client.switchEmbedding();

    expect(event?.dimensionsChanged).toBe(true);
    expect(event?.current.dimensions).toBe(8);
    expect(llmRuntime.embeddingModelLoaded).toBe(true);
    expect(llmRuntime.modelLoaded).toBe(true); // untouched (TZ §5.6 — embedding context only)
  });

  // --- ConversationSyncApi (Mode B, TZ §9.6) ---

  it('upsertChat()/appendMessages() work end to end through LocalAiClient', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });

    await client.upsertChat({ id: 'host-chat-1', title: 'From host app' });
    const result = await client.appendMessages('host-chat-1', [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(result).toEqual({ inserted: 1, skippedExisting: 0 });
    expect(await client.getMessages('host-chat-1')).toHaveLength(1);
  });

  // --- updateMessage() / deleteMessages() (Mode B, Phase 8, docs/decisions.md #7a) ---

  it('updateMessage() edits content and invalidates that chat\'s session-cache file only', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chatA = await client.createChat();
    const chatB = await client.createChat();

    llmRuntime.scriptedTokens = ['ok'];
    await client.sendMessage(chatA.id, 'first').result;
    await client.sendMessage(chatB.id, 'first').result;
    const sessionA = path.join(tmpDir, 'sessions', `session-${chatA.id}-qwen-4b:1.bin`);
    const sessionB = path.join(tmpDir, 'sessions', `session-${chatB.id}-qwen-4b:1.bin`);
    expect(fs.existsSync(sessionA)).toBe(true);
    expect(fs.existsSync(sessionB)).toBe(true);

    const [userMessage] = await client.getMessages(chatA.id);
    const updated = await client.updateMessage(chatA.id, userMessage!.id, { content: 'edited content' });

    expect(updated.content).toBe('edited content');
    expect(fs.existsSync(sessionA)).toBe(false); // invalidated
    expect(fs.existsSync(sessionB)).toBe(true); // untouched
  });

  it('updateMessage() on an unknown message id throws MessageNotFoundError', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    const chat = await client.createChat();
    await expect(client.updateMessage(chat.id, 'does-not-exist', { content: 'x' })).rejects.toThrow(
      MessageNotFoundError,
    );
  });

  it('deleteMessages() removes the given ids and reports the count', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    const chat = await client.createChat();
    await client.appendMessages(chat.id, [
      { id: 'm1', role: 'user', content: 'one', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'two', createdAt: '2026-01-01T00:00:01.000Z' },
    ]);

    const result = await client.deleteMessages(chat.id, ['m1']);

    expect(result).toEqual({ deleted: 1 });
    expect((await client.getMessages(chat.id)).map((m) => m.id)).toEqual(['m2']);
  });

  // --- searchMessages() (Phase 8, no TZ section — docs/decisions.md) ---

  it('searchMessages() finds a message by content across chats, and can be restricted to one chat', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    const chatA = await client.createChat({ id: 'a' });
    const chatB = await client.createChat({ id: 'b' });
    await client.appendMessages(chatA.id, [
      { id: 'm1', role: 'user', content: 'the treasure map is buried', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    await client.appendMessages(chatB.id, [
      { id: 'm2', role: 'user', content: 'completely unrelated', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const everywhere = await client.searchMessages('treasure map');
    expect(everywhere.map((h) => h.message.id)).toEqual(['m1']);

    const scoped = await client.searchMessages('treasure map', { chatId: 'b' });
    expect(scoped).toEqual([]);
  });

  // --- exportChat() / exportChats() (Phase 8) ---

  it('exportChat()/exportChats() round-trip through upsertChat()/appendMessages()', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    const chat = await client.createChat({ id: 'c1', title: 'Trip' });
    await client.appendMessages(chat.id, [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const exported = await client.exportChat('c1');
    expect(exported?.messages).toHaveLength(1);

    const all = await client.exportChats();
    expect(all.map((e) => e.chat.id)).toContain('c1');

    // Round-trip into a second, independent client/db.
    const otherDb = new NodeSqliteAdapter(':memory:');
    const otherClient = await LocalAiClient.create({ manifestUrl, ports: { ...ports, sqlite: otherDb } });
    await otherClient.upsertChat(exported!.chat);
    await otherClient.appendMessages(exported!.chat.id, exported!.messages);
    expect(await otherClient.getMessages('c1')).toHaveLength(1);
  });

  it('exportChat() resolves null for an unknown chat', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    expect(await client.exportChat('does-not-exist')).toBeNull();
  });

  // --- sessionCacheSlots (Phase 8 multi-slot LRU, docs/decisions.md #8) ---

  it('sessionCacheSlots bounds how many chats keep a session file, evicting the least-recently-used', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports, sessionCacheSlots: 1 });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chatA = await client.createChat();
    const chatB = await client.createChat();

    llmRuntime.scriptedTokens = ['ok'];
    await client.sendMessage(chatA.id, 'first').result;
    await client.sendMessage(chatB.id, 'second').result; // maxSlots: 1 -> evicts chat A's session file

    expect(fs.existsSync(path.join(tmpDir, 'sessions', `session-${chatA.id}-qwen-4b:1.bin`))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'sessions', `session-${chatB.id}-qwen-4b:1.bin`))).toBe(true);
  });

  // --- client.vectors.* — TZ §8.2/§8.3/§10 ---

  it('vectors.upsert()/search() auto-fill the VectorSpaceDescriptor from the active embedding', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest(); // embedding.dimensions = 4 in the shared manifestBody() fixture

    await client.vectors.upsert({ id: 'a', embedding: new Float32Array([1, 0, 0, 0]), text: 'alpha' });
    await client.vectors.upsert({ id: 'b', embedding: new Float32Array([0, 1, 0, 0]), text: 'beta' });
    expect(await client.vectors.count()).toBe(2);

    const hits = await client.vectors.search(new Float32Array([1, 0, 0, 0]), { topK: 1 });
    expect(hits[0]?.id).toBe('a');
  });

  it('vectors.reindex() wipes stored vectors and unblocks further writes', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.vectors.upsert({ id: 'a', embedding: new Float32Array([1, 0, 0, 0]) });

    await client.vectors.reindex();

    expect(await client.vectors.count()).toBe(0);
    await expect(client.vectors.upsert({ id: 'a', embedding: new Float32Array([1, 0, 0, 0]) })).resolves.toBeUndefined();
  });

  // --- releaseRuntime() / reload() / destroy() / autoUnloadOnBackground — TZ §11 ---

  it('releaseRuntime() releases both contexts, keeps chats/files, and is idempotent', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    await client.ensureEmbeddingReady();
    const chat = await client.createChat({ title: 'Survives release' });

    let unloadedReason: string | undefined;
    client.on('runtime:unloaded', (e) => {
      unloadedReason = e.reason;
    });

    await client.releaseRuntime();
    expect(unloadedReason).toBe('manual');
    expect(llmRuntime.modelLoaded).toBe(false);
    expect(llmRuntime.embeddingModelLoaded).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'models', 'model.gguf'))).toBe(true); // file untouched
    expect(await client.getChat(chat.id)).not.toBeNull(); // chat untouched

    await expect(client.releaseRuntime()).resolves.toBeUndefined(); // idempotent

    // complete() after release correctly reports "not ready" again, same as before the first ensureModelReady().
    const stream = client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await expect(stream.result).rejects.toThrow(RuntimeInitError);
  });

  it('unloadAll() is an alias for releaseRuntime()', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();

    await client.unloadAll();

    expect(llmRuntime.modelLoaded).toBe(false);
  });

  it('reload() re-establishes the model/embedding after a release without a network re-fetch', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();
    await client.ensureEmbeddingReady();
    await client.releaseRuntime();
    expect(llmRuntime.modelLoaded).toBe(false);

    await client.reload();

    expect(llmRuntime.modelLoaded).toBe(true);
    expect(llmRuntime.embeddingModelLoaded).toBe(true);
  });

  it('autoUnloadOnBackground releases the runtime when the app backgrounds, without an eager reload on refocus', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports, autoUnloadOnBackground: true });
    await client.refreshManifest();
    await client.ensureModelReady();

    const appLifecycle = ports.appLifecycle as FakeAppLifecycleAdapter;
    appLifecycle.setActive(false);
    await Promise.resolve(); // let the fire-and-forget release settle

    expect(llmRuntime.modelLoaded).toBe(false);

    appLifecycle.setActive(true); // refocus — TZ §11.2: no eager reload
    await Promise.resolve();
    expect(llmRuntime.modelLoaded).toBe(false);
  });

  it('autoUnloadOnBackground defers the release until an in-flight generation settles, instead of killing it mid-stream', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports, autoUnloadOnBackground: true });
    await client.refreshManifest();
    await client.ensureModelReady();
    const chat = await client.createChat({ title: 'Backgrounded mid-reply' });

    llmRuntime.scriptedOutcome = 'hang';
    const controller = new AbortController();
    const stream = client.sendMessage(chat.id, 'hi', { signal: controller.signal });

    // sendMessage() does real async work (persisting the user message,
    // building the context window, activating the session cache) before it
    // ever reaches runtimeFacade.complete() — wait for the fake runtime to
    // actually be invoked, so backgrounding below genuinely lands mid-generation
    // rather than racing ahead of it.
    for (let i = 0; i < 50 && llmRuntime.completeCalls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0)); // real I/O (sqlite/fs) is involved before complete() is reached, not just microtasks
    }
    expect(llmRuntime.completeCalls).toHaveLength(1);

    const appLifecycle = ports.appLifecycle as FakeAppLifecycleAdapter;
    appLifecycle.setActive(false);
    await Promise.resolve();
    await Promise.resolve();

    // Generation is still running — the context must NOT have been torn
    // down out from under it.
    expect(llmRuntime.modelLoaded).toBe(true);

    controller.abort(); // let the hung generation settle (as 'cancelled')
    await stream.result;
    await Promise.resolve(); // let the deferred release's awaited doReleaseRuntime() settle

    expect(llmRuntime.modelLoaded).toBe(false);
  });

  it('ensureModelReady() emits download:failed on a checksum mismatch (previously declared but never emitted, LOG.3)', async () => {
    const v2Body = manifestBody();
    v2Body.model.sha256 = 'a'.repeat(64); // deliberately wrong — never matches MODEL_BYTES' real hash
    stubManifest(v2Body);
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();

    let failedEvent: { key: string; kind: string; error: Error } | undefined;
    client.on('download:failed', (e) => {
      failedEvent = e;
    });

    await expect(client.ensureModelReady()).rejects.toThrow(ChecksumMismatchError);

    expect(failedEvent?.kind).toBe('model');
    expect(failedEvent?.error).toBeInstanceOf(ChecksumMismatchError);
  });

  // --- config.logging / exportLogs() / config.logger (LOG.3/LOG.4, ROADMAP.md "Local logging & export") ---

  it('config.logger receives calls for every LocalAiEventMap event, independent of config.logging', async () => {
    const calls: Array<{ level: string; message: string }> = [];
    const logger = {
      debug: (message: string) => calls.push({ level: 'debug', message }),
      info: (message: string) => calls.push({ level: 'info', message }),
      warn: (message: string) => calls.push({ level: 'warn', message }),
      error: (message: string) => calls.push({ level: 'error', message }),
    };
    // logging (the persisted store) is deliberately NOT enabled here — the
    // pluggable logger callback must fire regardless (docs/decisions.md).
    const client = await LocalAiClient.create({ manifestUrl, ports, logger });

    await client.createChat(); // emits chat:created -> debug

    expect(calls).toContainEqual({ level: 'debug', message: 'chat:created' });
    expect(await client.exportLogs()).toEqual([]); // logging.enabled unset -> nothing persisted regardless
  });

  it('exportLogs() is empty until logging.enabled is true, then round-trips a triggered event', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports, logging: { enabled: true } });

    await client.refreshManifest(); // emits manifest:updated -> info, meets the default minLevel: 'info'

    const logs = await client.exportLogs();
    expect(logs.some((l) => l.level === 'info' && l.message === 'manifest:updated')).toBe(true);
  });

  it('logging.enabled without an explicit minLevel defaults to "info" — debug-level events are not persisted', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports, logging: { enabled: true } });

    await client.createChat(); // chat:created -> debug, below the default minLevel
    await client.refreshManifest(); // manifest:updated -> info, meets it

    const logs = await client.exportLogs();
    expect(logs.some((l) => l.message === 'chat:created')).toBe(false);
    expect(logs.some((l) => l.message === 'manifest:updated')).toBe(true);
  });

  it('logging.minLevel raises the bar — only entries at or above it are persisted', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports, logging: { enabled: true, minLevel: 'error' } });
    await client.refreshManifest(); // manifest:updated -> info, caches a valid manifest first

    const invalidBody = manifestBody();
    invalidBody.model.source.revision = 'main';
    stubManifest(invalidBody);
    await client.refreshManifest(); // fails validation -> emits manifest:invalid -> error, meets minLevel: 'error'

    const logs = await client.exportLogs();
    expect(logs.every((l) => l.level === 'error')).toBe(true);
    expect(logs.some((l) => l.message === 'manifest:invalid')).toBe(true);
    expect(logs.some((l) => l.message === 'manifest:updated')).toBe(false); // info, below minLevel
  });

  it('a RuntimeInitError thrown with no corresponding LocalAiEventMap event still reaches config.logger', async () => {
    // complete() must return a CompletionStream synchronously (TZ §10.0 —
    // no async escape hatch), so it can't safely await a LogStore write
    // (see emit()'s doc comment on the "cannot start a transaction within a
    // transaction" risk that would create) — this path reaches the
    // pluggable logger callback only, not the persisted store.
    const calls: Array<{ level: string; message: string }> = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (message: string) => calls.push({ level: 'error', message }),
    };
    const client = await LocalAiClient.create({ manifestUrl, ports, logger, logging: { enabled: true } });

    const stream = client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await expect(stream.result).rejects.toThrow(RuntimeInitError);

    expect(calls.some((c) => c.message.includes('ensureModelReady'))).toBe(true);
    const logs = await client.exportLogs();
    expect(logs.some((l) => l.message.includes('ensureModelReady'))).toBe(false); // not persisted — see the comment above
  });

  it('exportLogs({ since }) only returns entries at or after the given Date', async () => {
    const clock = ports.clock as FakeClockAdapter;
    const client = await LocalAiClient.create({ manifestUrl, ports, logging: { enabled: true } });
    await client.refreshManifest(); // manifest:updated, before the cutoff

    clock.advance(60_000);
    const cutoff = clock.now();
    clock.advance(1000);
    await client.createChat(); // chat:created is debug (filtered by minLevel), so trigger another info-level event
    const invalidBody = manifestBody();
    invalidBody.model.source.revision = 'main';
    stubManifest(invalidBody);
    await client.refreshManifest(); // manifest:invalid, after the cutoff

    const logs = await client.exportLogs({ since: cutoff });
    expect(logs.every((l) => l.message !== 'manifest:updated' || new Date(l.ts) >= cutoff)).toBe(true);
    expect(logs.some((l) => l.message === 'manifest:invalid')).toBe(true);
  });

  it('clearLogs() empties the persisted store without affecting the config.logger callback', async () => {
    let loggerCalls = 0;
    const logger = {
      debug: () => { loggerCalls += 1; },
      info: () => { loggerCalls += 1; },
      warn: () => { loggerCalls += 1; },
      error: () => { loggerCalls += 1; },
    };
    const client = await LocalAiClient.create({ manifestUrl, ports, logger, logging: { enabled: true } });
    await client.refreshManifest();
    expect(await client.exportLogs()).not.toEqual([]);

    await client.clearLogs();

    expect(await client.exportLogs()).toEqual([]);
    expect(loggerCalls).toBeGreaterThan(0); // clearLogs() only clears the persisted store, not the callback's past behavior
  });

  it('destroy() releases the runtime, closes the database, and clears event listeners', async () => {
    const client = await LocalAiClient.create({ manifestUrl, ports });
    await client.refreshManifest();
    await client.ensureModelReady();

    let sawEvent = false;
    client.on('runtime:unloaded', () => {
      sawEvent = true;
    });

    await client.destroy();

    expect(sawEvent).toBe(true);
    expect(llmRuntime.modelLoaded).toBe(false);
    await expect(ports.sqlite.query('SELECT 1')).rejects.toBeDefined();
  });
});
