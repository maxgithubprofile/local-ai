import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { NodeLlamaCppAdapter } from '../../../src/adapters/node-testing/node-llama-cpp.adapter.js';
import { RuntimeInitError } from '../../../src/core/errors.js';

// Real inference against test/fixtures/stories260K.gguf (~1.2MB, ggml-org's
// own tiny CI test model — see ADR 0001 / node-llama-cpp.adapter.ts's doc
// comment). Not a mock: this actually loads a GGUF and runs the native
// llama.cpp backend, which is why these live under test/integration rather
// than test/unit and get a generous timeout (TZ §13.4).

const FIXTURE_PATH = path.resolve(import.meta.dirname, '../../fixtures/stories260K.gguf');

describe('NodeLlamaCppAdapter', () => {
  let adapter: NodeLlamaCppAdapter;

  beforeAll(async () => {
    adapter = new NodeLlamaCppAdapter();
    await adapter.loadModel({ modelPath: FIXTURE_PATH, contextLength: 512 });
  }, 60_000);

  afterAll(async () => {
    await adapter.releaseModel();
  });

  it('countTokens() tokenizes real text through the model', async () => {
    const count = await adapter.countTokens('Once upon a time');
    expect(count).toBeGreaterThan(0);
  });

  it('complete() streams tokens and resolves a non-empty "complete" result', async () => {
    const stream = adapter.complete({
      messages: [{ role: 'user', content: 'Once upon a time' }],
      options: { maxTokens: 16 },
    });

    const chunks: string[] = [];
    for await (const token of stream) {
      chunks.push(token.token);
    }
    const result = await stream.result;

    expect(result.status).toBe('complete');
    expect(result.content.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBe(result.content);
  }, 30_000);

  it('complete() honors an AbortSignal, resolving status "cancelled" with partial content', async () => {
    const controller = new AbortController();
    const stream = adapter.complete(
      { messages: [{ role: 'user', content: 'Once upon a time there was' }], options: { maxTokens: 200 } },
      controller.signal,
    );

    let seen = 0;
    for await (const token of stream) {
      seen += 1;
      if (token && seen === 2) controller.abort();
    }
    const result = await stream.result;

    expect(result.status).toBe('cancelled');
  }, 30_000);

  it('complete() with skipNativeTemplating uses the raw prompt as-is (mechanism 2)', async () => {
    const stream = adapter.complete(
      { messages: [{ role: 'user', content: 'Once upon a time' }], options: { maxTokens: 8 } },
      undefined,
      { skipNativeTemplating: true },
    );
    const result = await stream.result;
    expect(result.status).toBe('complete');
    expect(result.content.length).toBeGreaterThan(0);
  }, 30_000);

  it('saveSession()/loadSession() round-trip without throwing', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const sessionPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-session-')), 'session.bin');

    await adapter.saveSession(sessionPath);
    await adapter.loadSession(sessionPath);

    const stat = await fs.stat(sessionPath);
    expect(stat.size).toBeGreaterThan(0);
  }, 30_000);

  it('countTokens() before loadModel() throws RuntimeInitError', async () => {
    const fresh = new NodeLlamaCppAdapter();
    await expect(fresh.countTokens('x')).rejects.toThrow(RuntimeInitError);
  });
});
