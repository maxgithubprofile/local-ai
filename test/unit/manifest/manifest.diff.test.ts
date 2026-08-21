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
    const diff = diffManifest({ models: [model], embeddings: [embedding] }, {});
    expect(diff.modelChanged).toBe(true);
    expect(diff.embeddingChanged).toBe(true);
    expect(diff.models[0]?.from).toBeUndefined();
    expect(diff.embeddings[0]?.from).toBeUndefined();
  });

  it('reports neither changed when installed matches next exactly', () => {
    const diff = diffManifest({ models: [model], embeddings: [embedding] }, { models: [model], embeddings: [embedding] });
    expect(diff.modelChanged).toBe(false);
    expect(diff.embeddingChanged).toBe(false);
  });

  it('reports only modelChanged on a model version bump, independent of embedding', () => {
    const nextModel = { ...model, version: 2 };
    const diff = diffManifest({ models: [nextModel], embeddings: [embedding] }, { models: [model], embeddings: [embedding] });
    expect(diff.modelChanged).toBe(true);
    expect(diff.embeddingChanged).toBe(false);
    expect(diff.models[0]?.from).toEqual(model);
    expect(diff.models[0]?.to).toEqual(nextModel);
  });

  it('reports only embeddingChanged on an embedding version bump, independent of model', () => {
    const nextEmbedding = { ...embedding, version: 2 };
    const diff = diffManifest({ models: [model], embeddings: [nextEmbedding] }, { models: [model], embeddings: [embedding] });
    expect(diff.modelChanged).toBe(false);
    expect(diff.embeddingChanged).toBe(true);
  });

  it('treats a same-version different-id swap as changed', () => {
    const nextModel = { ...model, id: 'llama-4b' };
    const diff = diffManifest({ models: [nextModel], embeddings: [embedding] }, { models: [model], embeddings: [embedding] });
    expect(diff.modelChanged).toBe(true);
  });

  it('reports a model missing from next as changed with to: undefined', () => {
    const diff = diffManifest({ models: [], embeddings: [embedding] }, { models: [model], embeddings: [embedding] });
    expect(diff.modelChanged).toBe(true);
    expect(diff.models[0]?.id).toBe(model.id);
    expect(diff.models[0]?.to).toBeUndefined();
    expect(diff.models[0]?.from).toEqual(model);
  });

  it('reports two models independently, one changed one not', () => {
    const model2 = { ...model, id: 'small-model' };
    const model2v2 = { ...model2, version: 2 };
    const diff = diffManifest(
      { models: [model, model2v2], embeddings: [embedding] },
      { models: [model, model2], embeddings: [embedding] },
    );
    expect(diff.modelChanged).toBe(true);
    const first = diff.models.find((m) => m.id === model.id);
    const second = diff.models.find((m) => m.id === model2.id);
    expect(first?.changed).toBe(false);
    expect(second?.changed).toBe(true);
  });
});
