import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManifestService, validateManifest } from '../../../src/core/manifest/manifest.service.js';
import { ManifestFetchError, ManifestValidationError } from '../../../src/core/errors.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';
import type { EmbeddingArtifact, ModelArtifact } from '../../../src/core/manifest/manifest.schema.js';

// Explicit return type (rather than inferred from the object literal) so
// `models`/`embeddings` are typed as `ModelArtifact[]`/`EmbeddingArtifact[]`
// — widened to the real union types (`status`, `recommended`, etc.) instead
// of the narrow literal types TS would otherwise infer, so a second,
// differently-shaped-but-compatible model can be `.push()`-ed in the
// multi-model tests below.
function validManifestBody(): { manifestVersion: number; publishedAt: string; models: ModelArtifact[]; embeddings: EmbeddingArtifact[] } {
  return {
    manifestVersion: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    models: [
      {
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
        recommended: true,
      },
    ],
    embeddings: [
      {
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
    ],
  };
}

describe('validateManifest', () => {
  it('accepts a fully valid manifest', () => {
    const result = validateManifest(validManifestBody(), 4);
    expect(result.ok).toBe(true);
  });

  it('rejects revision "main"', () => {
    const body = validManifestBody();
    body.models[0]!.source.revision = 'main';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('revision'))).toBe(true);
  });

  it('rejects revision "HEAD"', () => {
    const body = validManifestBody();
    body.models[0]!.source.revision = 'HEAD';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects a non-https embedding URL', () => {
    const body = validManifestBody();
    body.embeddings[0]!.source.url = 'http://example.com/embedding.gguf';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('https://'))).toBe(true);
  });

  it('rejects when embedding.compatibleModelIds does not include model.id', () => {
    const body = validManifestBody();
    body.embeddings[0]!.compatibleModelIds = ['some-other-model'];
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects a model.filename containing a path separator', () => {
    const body = validManifestBody();
    body.models[0]!.filename = '../../etc/passwd.gguf';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('models[0].filename'))).toBe(true);
  });

  it('rejects a model.filename that is an absolute path', () => {
    const body = validManifestBody();
    body.models[0]!.filename = '/etc/passwd.gguf';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects a model.filename with a backslash', () => {
    const body = validManifestBody();
    body.models[0]!.filename = '..\\..\\windows\\system32\\evil.gguf';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects a model.filename not ending in .gguf', () => {
    const body = validManifestBody();
    body.models[0]!.filename = 'model__qwen-4b__v1.exe';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects an embedding.filename containing ".."', () => {
    const body = validManifestBody();
    body.embeddings[0]!.filename = 'embedding__..__v1.gguf';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('embeddings[0].filename'))).toBe(true);
  });

  it('accepts a normal dotted-version filename', () => {
    const body = validManifestBody();
    body.models[0]!.filename = 'model__qwen-4b__v1.2.gguf';
    expect(validateManifest(body, 4).ok).toBe(true);
  });

  it('rejects a malformed sha256', () => {
    const body = validManifestBody();
    body.models[0]!.sha256 = 'not-a-hash';
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects sizeBytes <= 0', () => {
    const body = validManifestBody();
    body.embeddings[0]!.sizeBytes = 0;
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects paramsB above maxModelParamsB', () => {
    const body = validManifestBody();
    body.models[0]!.paramsB = 7;
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('rejects recommendedRamGb below minRamGb', () => {
    const body = validManifestBody();
    body.models[0]!.recommendedRamGb = 1;
    expect(validateManifest(body, 4).ok).toBe(false);
  });

  it('collects multiple errors at once rather than stopping at the first', () => {
    const body = validManifestBody();
    body.models[0]!.source.revision = 'main';
    body.embeddings[0]!.source.url = 'http://insecure.example.com';
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  // Multi-model manifest coverage — docs/plans/llama2/2026-08-21-multi-model-selection-plan.md §4.

  function secondModel(): ModelArtifact {
    return {
      id: 'small-model',
      version: 1,
      displayName: 'Small Model',
      family: 'qwen',
      paramsB: 1.5,
      quant: 'Q4_K_M',
      languages: 'multilingual' as const,
      contextLength: 4096,
      source: { type: 'huggingface' as const, repo: 'org/small', revision: 'def456abc789', file: 'small.gguf' },
      filename: 'model__small-model__v1.gguf',
      sha256: 'c'.repeat(64),
      sizeBytes: 900_000_000,
      minRamGb: 2,
      recommendedRamGb: 4,
      chatTemplate: 'auto' as const,
      status: 'active' as const,
    };
  }

  it('rejects models: [] (empty array)', () => {
    const body = validManifestBody();
    body.models = [];
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('models must be a non-empty array'))).toBe(true);
  });

  it('reports a broken field on the second of two models with its own index, not the first', () => {
    const body = validManifestBody();
    const second = secondModel();
    second.sha256 = 'not-a-hash';
    body.models.push(second);
    body.embeddings[0]!.compatibleModelIds = ['qwen-4b', 'small-model'];
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('models[1].sha256'))).toBe(true);
      expect(result.errors.some((e) => e.includes('models[0]'))).toBe(false);
    }
  });

  it('accepts two valid models sharing one compatible embedding', () => {
    const body = validManifestBody();
    body.models.push(secondModel());
    body.embeddings[0]!.compatibleModelIds = ['qwen-4b', 'small-model'];
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.models).toHaveLength(2);
  });

  it('rejects an active model with no compatible active embedding', () => {
    const body = validManifestBody();
    body.models.push(secondModel()); // embeddings[0].compatibleModelIds still only names qwen-4b
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('compatibleModelIds including active model "small-model"'))).toBe(true);
    }
  });

  it('does not require a compatible embedding for a deprecated model', () => {
    const body = validManifestBody();
    const deprecated = secondModel();
    deprecated.status = 'deprecated';
    body.models.push(deprecated); // still no embedding compatible with "small-model"
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(true);
  });

  it('excludes an oversized model from models[] rather than invalidating the whole manifest', () => {
    const body = validManifestBody();
    const tooBig = secondModel();
    tooBig.id = 'huge-model';
    tooBig.paramsB = 30;
    body.models.push(tooBig);
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.models.map((m) => m.id)).toEqual(['qwen-4b']);
    }
  });

  it('fails when every model is excluded by maxModelParamsB', () => {
    const body = validManifestBody();
    body.models[0]!.paramsB = 30;
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('no model in models[] is within maxModelParamsB'))).toBe(true);
    }
  });

  it('rejects more than one model with recommended: true', () => {
    const body = validManifestBody();
    const second = secondModel();
    second.recommended = true;
    body.models.push(second);
    body.embeddings[0]!.compatibleModelIds = ['qwen-4b', 'small-model'];
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('recommended: true'))).toBe(true);
  });

  it('accepts a manifest with zero models marked recommended', () => {
    const body = validManifestBody();
    body.models[0]!.recommended = false;
    expect(validateManifest(body, 4).ok).toBe(true);
  });

  it('rejects a duplicate model id', () => {
    const body = validManifestBody();
    const dupe = { ...secondModel(), id: 'qwen-4b' };
    body.models.push(dupe);
    const result = validateManifest(body, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('is duplicated'))).toBe(true);
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
    invalidBody.models[0]!.source.revision = 'main';
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
    second.models[0]!.version = 2;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200, headers: { etag: '"v2"' } }));
    vi.stubGlobal('fetch', fetchMock);

    const service = await makeService();
    await service.refresh();
    const { diff } = await service.refresh();

    expect(diff.modelChanged).toBe(true);
    expect(diff.models[0]?.from?.version).toBe(1);
    expect(diff.models[0]?.to?.version).toBe(2);
  });
});
