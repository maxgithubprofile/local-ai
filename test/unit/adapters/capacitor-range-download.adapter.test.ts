import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';
import { bytesToBase64 } from '../../../src/adapters/shared/base64.js';

/**
 * `CapacitorRangeDownloadAdapter` — built 2026-08-19 because
 * `CapgoDownloaderAdapter` (Android `DownloadManager`) turned out to have no
 * real resume at all (see its own test file's doc comment). This adapter's
 * new logic (chunking, resume-offset math, Content-Range parsing, cancel
 * handling) is what's under test here — `@capacitor/core`'s own `CapacitorHttp`
 * transport is mocked with an in-memory Range-aware fake rather than a real
 * HTTP server, since exercising the real native bridge needs a device
 * (CLAUDE.md's testing rule) and `@capacitor/core`'s own HTTP transport is
 * its own to verify, not this adapter's.
 */

interface FakeServerOptions {
  ignoreRanges?: boolean;
}

function makeFakeCapacitorHttp(content: Uint8Array, options: FakeServerOptions = {}) {
  const requestCalls: { headers: Record<string, string> }[] = [];
  const request = vi.fn().mockImplementation(async (opts: { headers?: Record<string, string> }) => {
    requestCalls.push({ headers: opts.headers ?? {} });
    const range = opts.headers?.Range;
    const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;

    if (!match || options.ignoreRanges) {
      // Server ignoring Range entirely -> whole content, status 200.
      return { status: 200, headers: {}, data: bytesToBase64(content), url: '', };
    }

    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), content.length - 1);
    if (start >= content.length) {
      return { status: 206, headers: { 'content-range': `bytes */${content.length}` }, data: '', url: '' };
    }
    const slice = content.subarray(start, end + 1);
    return {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${content.length}` },
      data: bytesToBase64(slice),
      url: '',
    };
  });
  return { request, requestCalls };
}

// vi.mock factories are hoisted above imports/local variables, so the mock
// can't close over a per-test `request` function directly — routed through
// a global slot each test overwrites instead.
const globalSlot = globalThis as unknown as { __fakeRequest?: (...args: unknown[]) => unknown };
function setFakeRequest(fn: (...args: unknown[]) => unknown): void {
  globalSlot.__fakeRequest = fn;
}

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: (...args: unknown[]) => globalSlot.__fakeRequest!(...args) },
}));

const { CapacitorRangeDownloadAdapter } = await import('../../../src/adapters/capacitor/capacitor-range-download.adapter.js');

describe('CapacitorRangeDownloadAdapter', () => {
  let tmpDir: string;
  let fileSystem: NodeFsAdapter;
  let destinationPath: string;
  let content: Buffer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-range-download-'));
    fileSystem = new NodeFsAdapter(tmpDir);
    destinationPath = fileSystem.resolvePath('artifact.bin');
    content = Buffer.alloc(50_000);
    for (let i = 0; i < content.length; i++) content[i] = i % 256;
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    delete globalSlot.__fakeRequest;
  });

  function waitForCompletion(transport: InstanceType<typeof CapacitorRangeDownloadAdapter>, id: string): Promise<void> {
    return new Promise((resolve) => {
      const unsub = transport.onCompleted((e) => {
        if (e.id !== id) return;
        unsub();
        resolve();
      });
    });
  }

  function waitForFailure(transport: InstanceType<typeof CapacitorRangeDownloadAdapter>, id: string): Promise<string> {
    return new Promise((resolve) => {
      const unsub = transport.onFailed((e) => {
        if (e.id !== id) return;
        unsub();
        resolve(e.error);
      });
    });
  }

  it('supportsResume is true', () => {
    const { request } = makeFakeCapacitorHttp(content);
    setFakeRequest(request);
    expect(new CapacitorRangeDownloadAdapter(fileSystem, 1000).supportsResume).toBe(true);
  });

  it('downloads the full content across multiple chunks', async () => {
    const { request } = makeFakeCapacitorHttp(content);
    setFakeRequest(request);
    const transport = new CapacitorRangeDownloadAdapter(fileSystem, 8000); // forces several chunks for 50KB content

    const completed = waitForCompletion(transport, 't1');
    await transport.start({ id: 't1', url: 'https://example.test/file', destinationPath });
    await completed;

    expect(fs.readFileSync(destinationPath).equals(content)).toBe(true);
    expect(request.mock.calls.length).toBeGreaterThan(1); // genuinely chunked, not one giant request
  });

  it('reports progress climbing to 100', async () => {
    const { request } = makeFakeCapacitorHttp(content);
    setFakeRequest(request);
    const transport = new CapacitorRangeDownloadAdapter(fileSystem, 8000);
    const percents: number[] = [];
    transport.onProgress((e) => percents.push(e.progressPercent));

    const completed = waitForCompletion(transport, 't2');
    await transport.start({ id: 't2', url: 'https://example.test/file', destinationPath });
    await completed;

    expect(percents.length).toBeGreaterThan(1);
    expect(percents[percents.length - 1]).toBe(100);
    expect(percents).toEqual([...percents].sort((a, b) => a - b)); // monotonically non-decreasing
  });

  it('resumes from an existing partial file — requests only the remaining bytes, ends up byte-identical', async () => {
    const existingBytes = 20_000;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(destinationPath, content.subarray(0, existingBytes));

    const { request, requestCalls } = makeFakeCapacitorHttp(content);
    setFakeRequest(request);
    const transport = new CapacitorRangeDownloadAdapter(fileSystem, 8000);

    const completed = waitForCompletion(transport, 't3');
    await transport.start({ id: 't3', url: 'https://example.test/file', destinationPath });
    await completed;

    expect(fs.readFileSync(destinationPath).equals(content)).toBe(true);
    expect(requestCalls[0]!.headers.Range).toBe(`bytes=${existingBytes}-${existingBytes + 8000 - 1}`);
  });

  it('fails cleanly (does not corrupt/append) when the server ignores Range', async () => {
    const { request } = makeFakeCapacitorHttp(content, { ignoreRanges: true });
    setFakeRequest(request);
    const transport = new CapacitorRangeDownloadAdapter(fileSystem, 8000);

    const failed = waitForFailure(transport, 't4');
    await transport.start({ id: 't4', url: 'https://example.test/file', destinationPath });
    const error = await failed;

    expect(error).toMatch(/Range/);
  });

  it('pause() stops the loop without firing onCompleted or onFailed', async () => {
    let resolveGate: () => void;
    const gate = new Promise<void>((r) => (resolveGate = r));
    const request = vi.fn().mockImplementation(async (opts: { headers?: Record<string, string> }) => {
      await gate; // first chunk request hangs until the test releases it
      const start = Number(/bytes=(\d+)-(\d+)/.exec(opts.headers?.Range ?? '')?.[1] ?? 0);
      const end = Math.min(start + 7999, content.length - 1);
      return {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${content.length}` },
        data: bytesToBase64(content.subarray(start, end + 1)),
        url: '',
      };
    });
    setFakeRequest(request);
    const transport = new CapacitorRangeDownloadAdapter(fileSystem, 8000);
    let completed = false;
    let failed = false;
    transport.onCompleted(() => (completed = true));
    transport.onFailed(() => (failed = true));

    await transport.start({ id: 't5', url: 'https://example.test/file', destinationPath });
    await transport.pause('t5');
    resolveGate!();
    await new Promise((r) => setTimeout(r, 20)); // let the in-flight request's continuation run

    expect(completed).toBe(false);
    expect(failed).toBe(false);
    expect((await transport.status('t5')).state).toBe('paused');
  });
});
