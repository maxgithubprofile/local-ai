import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalAiClient } from '../../../src/core/client/local-ai-client.js';
import type { LocalAiPorts } from '../../../src/core/ports/index.js';
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
import { ConfigInvalidError, DeviceNotEligibleError } from '../../../src/core/errors.js';
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
  let deviceInfo: FakeDeviceInfoAdapter;
  let llmRuntime: FakeLlmRuntimeAdapter;
  let ports: LocalAiPorts;
  let manifestUrl: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-client-'));
    modelServer = createMockDownloadServer(MODEL_BYTES);
    const modelUrl = await modelServer.listen();
    manifestUrl = 'https://example.com/manifest.json';

    const body = manifestBody();
    // Route both the "model" (HF) and "embedding" (URL) artifact downloads
    // to the same local mock server — DownloadEngine only cares about the
    // resolved URL string, not that it's really huggingface.co/example.com.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === manifestUrl) {
          return new Response(JSON.stringify(body), { status: 200, headers: { etag: '"v1"' } });
        }
        if (url.includes('huggingface.co') || url === body.embedding.source.url) {
          // Both the "model" (HF) and "embedding" (URL) artifact downloads
          // route to the same local mock server — DownloadEngine only cares
          // about the resolved URL string and byte content, not that it's
          // really huggingface.co/example.com. Use the real fetch
          // (captured before stubbing) to actually reach it.
          return realFetch(modelUrl, init);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

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
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('create() throws ConfigInvalidError when ports are incomplete', async () => {
    await expect(
      LocalAiClient.create({ manifestUrl, ports: { platformSupport: ports.platformSupport } }),
    ).rejects.toThrow(ConfigInvalidError);
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(invalidBody), { status: 200 })),
    );

    let invalidEventFired = false;
    client.on('manifest:invalid', () => {
      invalidEventFired = true;
    });

    const diff = await client.refreshManifest();
    expect(invalidEventFired).toBe(true);
    expect(diff.modelChanged).toBe(false); // still the previously cached manifest, reported as unchanged
  });
});
