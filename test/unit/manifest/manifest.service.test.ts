import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManifestService, validateManifest } from '../../../src/core/manifest/manifest.service.js';
import { ManifestFetchError, ManifestValidationError } from '../../../src/core/errors.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';

function validManifestBody() {
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
      contextLength: 8192,
      source: { type: 'huggingface', repo: 'org/qwen', revision: 'abc123def456', file: 'model.gguf' },
      filename: 'model__qwen-4b__v1.gguf',
      sha256: 'a'.repeat(64),
      sizeBytes: 2_500_000_000,
      minRamGb: 4,
      recommendedRamGb: 8,
      chatTemplate: 'auto',
      status: 'active',
    },
    embedding: {
      id: 'bge-small',
      version: 1,
      compatibleModelIds: ['qwen-4b'],
      dimensions: 384,
      source: { type: 'url', url: 'https://example.com/embedding.gguf' },
      filename: 'embedding__bge-small__v1.gguf',
      sha256: 'b'.repeat(64),
      sizeBytes: 100_000_000,
      minRamGb: 1,
      recommendedRamGb: 2,
      status: 'active',
    },
  };
}

describe('validateManifest', () => {
  it('accepts a fully valid manifest', () => {
    const result = validateManifest(validManifestBody(), 4);
    expect(result.ok).toBe(true);
  });

  it('rejects revision "main"', () => {
    const body = validManifestBody();
    body.model.source.revision = 'main';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('revision'))).toBe(true);
  });

  it('rejects revision "HEAD"', () => {
    const body = validManifestBody();
    body.model.source.revision = 'HEAD';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects a non-https embedding URL', () => {
    const body = validManifestBody();
    body.embedding.source.url = 'http://example.com/embedding.gguf';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('https://'))).toBe(true);
  });

  it('rejects when embedding.compatibleModelIds does not include model.id', () => {
    const body = validManifestBody();
    body.embedding.compatibleModelIds = ['some-other-model'];
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects a malformed sha256', () => {
    const body = validManifestBody();
    body.model.sha256 = 'not-a-hash';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects sizeBytes <= 0', () => {
    const body = validManifestBody();
    body.embedding.sizeBytes = 0;
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects paramsB above maxModelParamsB', () => {
    const body = validManifestBody();
    body.model.paramsB = 7;
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects recommendedRamGb below minRamGb', () => {
    const body = validManifestBody();
    body.model.recommendedRamGb = 1;
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('collects multiple errors at once rather than stopping at the first', () => {
    const body = validManifestBody();
    body.model.source.revision = 'main';
    body.embedding.source.url = 'http://insecure.example.com';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ManifestService.refresh()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function makeService(url = 'https://example.com/manifest.json') {
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();
    return new ManifestService(url, sqlite, new FakeClockAdapter());
  }

  it('fetches, validates, and caches a manifest on first refresh (both changed = true)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifestBody()), { status: 200, headers: { etag: '"v1"' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = await makeService();
    const { diff, notModified } = await service.refresh();

    expect(notModified).toBe(false);
    expect(diff.modelChanged).toBe(true);
    expect(diff.embeddingChanged).toBe(true);
    expect(await service.getCachedManifest()).not.toBeNull();
  });

  it('sends If-None-Match with the cached ETag on a subsequent refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(validManifestBody()), { status: 200, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = await makeService();
    await service.refresh();
    const second = await service.refresh();

    expect(second.notModified).toBe(true);
    expect(second.diff.modelChanged).toBe(false);
    expect(second.diff.embeddingChanged).toBe(false);
    const secondCallHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondCallHeaders['If-None-Match']).toBe('"v1"');
  });

  it('throws ManifestValidationError on an invalid manifest and leaves no cache behind', async () => {
    const invalidBody = validManifestBody();
    invalidBody.model.source.revision = 'main';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalidBody), { status: 200 })));

    const service = await makeService();
    await expect(service.refresh()).rejects.toThrow(ManifestValidationError);
    expect(await service.getCachedManifest()).toBeNull();
  });

  it('throws ManifestFetchError on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    const service = await makeService();
    await expect(service.refresh()).rejects.toThrow(ManifestFetchError);
  });

  it('throws ManifestFetchError when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const service = await makeService();
    await expect(service.refresh()).rejects.toThrow(ManifestFetchError);
  });

  it('a second successful refresh with a version bump reports installed (previous cache) as "from"', async () => {
    const first = validManifestBody();
    const second = validManifestBody();
    second.model.version = 2;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200, headers: { etag: '"v2"' } }));
    vi.stubGlobal('fetch', fetchMock);

    const service = await makeService();
    await service.refresh();
    const { diff } = await service.refresh();

    expect(diff.modelChanged).toBe(true);
    expect(diff.model.from?.version).toBe(1);
    expect(diff.model.to.version).toBe(2);
  });
});
