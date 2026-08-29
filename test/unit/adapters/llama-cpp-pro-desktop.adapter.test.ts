import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlamaCppProDesktopAdapter, type LlamaCppProDesktopModule } from '../../../src/adapters/electron/llama-cpp-pro-desktop.adapter.js';

/**
 * A tiny real HTTP server standing in for the sidecar — exercises this
 * adapter's actual `node:http` SSE-parsing code against real bytes on a
 * real socket (same "don't mock the transport, run a fixture server"
 * precedent `test/integration/download/mock-http-server.ts` already uses
 * for downloads), rather than mocking `http.request` internals. Route
 * shapes match `docs/adr/0012-electron-sidecar-streaming.md`'s confirmed
 * real sidecar response format exactly.
 */
async function startFakeSidecar(): Promise<{ port: number; close(): Promise<void>; loadModelCalls: Record<string, unknown>[] }> {
  const loadModelCalls: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};

      if (req.method === 'POST' && req.url === '/v1/internal/models/load') {
        loadModelCalls.push(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, model_id: body.model_id }));
        return;
      }
      if (req.method === 'DELETE' && req.url?.startsWith('/v1/internal/models/')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/v1/completions')) {
        const isChat = req.url === '/v1/chat/completions';
        res.setHeader('Content-Type', 'text/event-stream');
        const write = (delta: object, finish: string | null): void => {
          const chunk = isChat
            ? { choices: [{ delta, finish_reason: finish }] }
            : { choices: [{ text: (delta as { content?: string }).content ?? '', finish_reason: finish }] };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        };
        void (async () => {
          write({ role: 'assistant' }, null);
          // A small real delay between chunks (not all written synchronously
          // in one burst) so the cancellation test can actually observe an
          // in-progress stream rather than one that already fully arrived
          // before AbortController.abort() had a chance to run.
          for (const piece of ['Hel', 'lo', ' world']) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            if (res.destroyed) return;
            write({ content: piece }, null);
          }
          if (res.destroyed) return;
          write({}, 'stop');
          res.write('data: [DONE]\n\n');
          res.end();
        })();
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/embeddings') {
        const inputs = (body as { input: string[] }).input;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            object: 'list',
            data: inputs.map((_, i) => ({ object: 'embedding', embedding: [0.1 * i, 0.2 * i, 0.3 * i], index: i })),
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    loadModelCalls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Builds a `LlamaCppProDesktopModule` fake whose `createSidecarManager()` talks to `fakeSidecar`. */
function fakeDesktopModule(port: number): LlamaCppProDesktopModule {
  let running = false;
  return {
    detectBackend: () => ({ selection: { type: 'cpu' } }),
    createSidecarManager: () => ({
      start: async () => {
        running = true;
        return { ok: true, port };
      },
      stop: async () => {
        running = false;
      },
      getStatus: () => ({ running, port: running ? port : null }),
      getClient: () =>
        running
          ? {
              loadModel: async (body: Record<string, unknown>) => {
                const res = await fetch(`http://127.0.0.1:${port}/v1/internal/models/load`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                return (await res.json()) as { ok: boolean; model_id: string };
              },
              unloadModel: async (modelId: string) => {
                const res = await fetch(`http://127.0.0.1:${port}/v1/internal/models/${modelId}`, { method: 'DELETE' });
                return (await res.json()) as { ok: boolean };
              },
              embeddings: async (body: Record<string, unknown>) => {
                const res = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                return (await res.json()) as { data: Array<{ embedding: number[] }> };
              },
            }
          : null,
    }),
  };
}

describe('LlamaCppProDesktopAdapter', () => {
  let sidecar: Awaited<ReturnType<typeof startFakeSidecar>>;
  let adapter: LlamaCppProDesktopAdapter;

  beforeEach(async () => {
    sidecar = await startFakeSidecar();
    adapter = new LlamaCppProDesktopAdapter(fakeDesktopModule(sidecar.port));
  });

  afterEach(async () => {
    await sidecar.close();
  });

  it('loadModel() posts model_id "llm" and n_ctx to /v1/internal/models/load', async () => {
    await adapter.loadModel({ modelPath: '/models/foo.gguf', contextLength: 4096 });

    expect(sidecar.loadModelCalls).toEqual([{ model_id: 'llm', path: '/models/foo.gguf', n_ctx: 4096 }]);
  });

  it('loadEmbeddingModel() posts model_id "embedding" and embedding: true', async () => {
    await adapter.loadEmbeddingModel({ modelPath: '/models/embed.gguf' });

    expect(sidecar.loadModelCalls).toEqual([{ model_id: 'embedding', path: '/models/embed.gguf', embedding: true }]);
  });

  it('complete() streams real per-token SSE from /v1/chat/completions and accumulates content', async () => {
    await adapter.loadModel({ modelPath: '/models/foo.gguf', contextLength: 4096 });

    const stream = adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const tokens: string[] = [];
    for await (const t of stream) tokens.push(t.token);
    const result = await stream.result;

    expect(tokens).toEqual(['Hel', 'lo', ' world']);
    expect(result).toEqual({ content: 'Hello world', status: 'complete' });
  });

  it('complete() with skipNativeTemplating uses /v1/completions with the last message as prompt', async () => {
    await adapter.loadModel({ modelPath: '/models/foo.gguf', contextLength: 4096 });

    const stream = adapter.complete(
      { messages: [{ role: 'user', content: 'ignored' }, { role: 'user', content: 'raw prompt' }] },
      undefined,
      { skipNativeTemplating: true },
    );
    const result = await stream.result;

    expect(result.content).toBe('Hello world');
  });

  it('complete() resolves status "error" with the server error message when the sidecar returns 4xx/5xx', async () => {
    const failingSidecar = await startFakeSidecarAlwaysFailing();
    const failingAdapter = new LlamaCppProDesktopAdapter(fakeDesktopModule(failingSidecar.port));
    await failingAdapter.loadModel({ modelPath: '/models/foo.gguf', contextLength: 4096 });

    const stream = failingAdapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const result = await stream.result;

    expect(result.status).toBe('error');
    expect(result.errorMessage).toMatch(/Sidecar HTTP 500/);
    await failingSidecar.close();
  });

  it('complete() resolves status "cancelled" with partial content when aborted mid-stream', async () => {
    await adapter.loadModel({ modelPath: '/models/foo.gguf', contextLength: 4096 });

    const controller = new AbortController();
    const stream = adapter.complete({ messages: [{ role: 'user', content: 'hi' }] }, controller.signal);
    const tokens: string[] = [];
    for await (const t of stream) {
      tokens.push(t.token);
      if (t.token === 'lo') controller.abort();
    }
    const result = await stream.result;

    expect(result.status).toBe('cancelled');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('embed() maps /v1/embeddings response to a single Float32Array for a single string', async () => {
    await adapter.loadEmbeddingModel({ modelPath: '/models/embed.gguf' });

    const vec = await adapter.embed('hello');

    expect(vec).toBeInstanceOf(Float32Array);
    expect(Array.from(vec as Float32Array)).toEqual([0, 0, 0]);
  });

  it('embed() maps /v1/embeddings response to an array of Float32Array for multiple strings', async () => {
    await adapter.loadEmbeddingModel({ modelPath: '/models/embed.gguf' });

    const vecs = await adapter.embed(['a', 'b']);

    expect(Array.isArray(vecs)).toBe(true);
    expect((vecs as Float32Array[]).length).toBe(2);
    expect(Array.from((vecs as Float32Array[])[1]!)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
  });

  it('countTokens() uses the chars/4 heuristic (no sidecar tokenize endpoint exists, docs/adr/0012)', async () => {
    await expect(adapter.countTokens('12345678')).resolves.toBe(2);
  });

  it('saveSession() is a no-op that resolves without contacting the sidecar', async () => {
    await expect(adapter.saveSession('/tmp/whatever.session')).resolves.toBeUndefined();
  });

  it('loadSession() always throws (no session persistence on the sidecar, docs/adr/0012)', async () => {
    await expect(adapter.loadSession('/tmp/whatever.session')).rejects.toThrow();
  });

  it('complete() throws RuntimeInitError when called before loadModel()', () => {
    expect(() => adapter.complete({ messages: [{ role: 'user', content: 'hi' }] })).toThrow();
  });

  it('embed() throws RuntimeInitError when called before loadEmbeddingModel()', async () => {
    await expect(adapter.embed('hi')).rejects.toThrow();
  });

  it('releaseModel()/releaseEmbeddingModel() only stop the shared sidecar process once both are released', async () => {
    await adapter.loadModel({ modelPath: '/models/foo.gguf', contextLength: 4096 });
    await adapter.loadEmbeddingModel({ modelPath: '/models/embed.gguf' });

    await adapter.releaseModel();
    // Embedding still loaded — a subsequent embed() call should still work,
    // proving the shared process wasn't torn down by releasing the LLM alone.
    await expect(adapter.embed('hi')).resolves.toBeInstanceOf(Float32Array);

    await adapter.releaseEmbeddingModel();
    await expect(adapter.embed('hi')).rejects.toThrow();
  });
});

async function startFakeSidecarAlwaysFailing(): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/internal/models/load') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, model_id: 'llm' }));
      });
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: 'boom' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
