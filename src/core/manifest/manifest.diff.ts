import type { EmbeddingArtifact, ModelArtifact } from './manifest.schema.js';

/**
 * Result of comparing a freshly fetched manifest against what's installed —
 * TZ §5.4. Model and embedding changes are reported independently: a
 * consumer can react to `embeddingChanged` without necessarily re-pulling
 * the (much larger) model, and vice versa. Produced by `ManifestService`,
 * never started automatically — TZ §5.4: "Скачивание не стартует
 * автоматически по факту diff".
 */
export interface ManifestDiff {
  modelChanged: boolean;
  embeddingChanged: boolean;
  model: { from?: ModelArtifact; to: ModelArtifact };
  embedding: { from?: EmbeddingArtifact; to: EmbeddingArtifact };
}

/**
 * Not implemented — Phase 1 (ROADMAP.md). Compares `installed.modelVersion`
 * / `installed.embeddingVersion` against a freshly validated manifest per
 * TZ §5.4's flow (handles the 304-not-modified short-circuit upstream, in
 * `ManifestService`).
 */
export function diffManifest(): ManifestDiff {
  throw new Error('not implemented — see TZ §5.4, ROADMAP Phase 1');
}
