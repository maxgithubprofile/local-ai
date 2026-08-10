import { describe, expect, it } from 'vitest';
import { diffManifest } from '../../../src/core/manifest/manifest.diff.js';
import type { EmbeddingArtifact, ModelArtifact } from '../../../src/core/manifest/manifest.schema.js';

const model: ModelArtifact = {
  id: 'qwen-4b',
  version: 1,
  displayName: 'Qwen 4B',
  family: 'qwen',
  paramsB: 4,
  quant: 'Q4_K_M',
  languages: 'multilingual',
  contextLength: 8192,
  source: { type: 'huggingface', repo: 'org/qwen', revision: 'abc123', file: 'model.gguf' },
  filename: 'model__qwen-4b__v1.gguf',
  sha256: 'a'.repeat(64),
  sizeBytes: 2_500_000_000,
  minRamGb: 4,
  recommendedRamGb: 8,
  chatTemplate: 'auto',
  status: 'active',
};

const embedding: EmbeddingArtifact = {
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
};

describe('diffManifest', () => {
  it('reports both changed when nothing is installed yet (first run)', () => {
    const diff = diffManifest({ model, embedding }, {});
    expect(diff.modelChanged).toBe(true);
    expect(diff.embeddingChanged).toBe(true);
    expect(diff.model.from).toBeUndefined();
    expect(diff.embedding.from).toBeUndefined();
  });

  it('reports neither changed when installed matches next exactly', () => {
    const diff = diffManifest({ model, embedding }, { model, embedding });
    expect(diff.modelChanged).toBe(false);
    expect(diff.embeddingChanged).toBe(false);
  });

  it('reports only modelChanged on a model version bump, independent of embedding', () => {
    const nextModel = { ...model, version: 2 };
    const diff = diffManifest({ model: nextModel, embedding }, { model, embedding });
    expect(diff.modelChanged).toBe(true);
    expect(diff.embeddingChanged).toBe(false);
    expect(diff.model.from).toEqual(model);
    expect(diff.model.to).toEqual(nextModel);
  });

  it('reports only embeddingChanged on an embedding version bump, independent of model', () => {
    const nextEmbedding = { ...embedding, version: 2 };
    const diff = diffManifest({ model, embedding: nextEmbedding }, { model, embedding });
    expect(diff.modelChanged).toBe(false);
    expect(diff.embeddingChanged).toBe(true);
  });

  it('treats a same-version different-id swap as changed', () => {
    const nextModel = { ...model, id: 'llama-4b' };
    const diff = diffManifest({ model: nextModel, embedding }, { model, embedding });
    expect(diff.modelChanged).toBe(true);
  });
});
