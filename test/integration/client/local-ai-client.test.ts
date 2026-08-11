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
import { ConfigInvalidError, DeviceNotEligibleError, RuntimeInitError } from '../../../src/core/errors.js';
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
