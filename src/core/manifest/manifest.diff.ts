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
 * Compares `next` against `installed` (TZ §5.4's "сравнить
 * installed.modelVersion / installed.embeddingVersion"). `installed` is
 * whatever the caller currently considers the source of truth for "what's
 * on this device": `ModelRegistry`'s `installed_artifacts` rows once that's
 * wired (Phase 2/5), or — until then — `ManifestService` passing the
 * previously cached manifest's artifacts as a best-effort stand-in (nothing
 * is actually installed yet in that case, so `undefined` fields there
 * still correctly report `modelChanged`/`embeddingChanged: true`).
 *
 * Changed = different `id` **or** different `version` — a same-`id`
 * version bump and a full model swap are both "changed", exactly alike;
 * callers that care about the distinction can compare `from.id`/`to.id`
 * themselves.
 */
export function diffManifest(
  next: { model: ModelArtifact; embedding: EmbeddingArtifact },
  installed: { model?: ModelArtifact; embedding?: EmbeddingArtifact },
): ManifestDiff {
  const modelChanged =
    !installed.model || installed.model.id !== next.model.id || installed.model.version !== next.model.version;
  const embeddingChanged =
    !installed.embedding ||
    installed.embedding.id !== next.embedding.id ||
    installed.embedding.version !== next.embedding.version;

  return {
    modelChanged,
    embeddingChanged,
    model: { from: installed.model, to: next.model },
    embedding: { from: installed.embedding, to: next.embedding },
  };
}
