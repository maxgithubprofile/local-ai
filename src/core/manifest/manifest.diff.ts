import type { EmbeddingArtifact, ModelArtifact } from './manifest.schema.js';

/** One artifact's before/after across a manifest refresh, keyed by id — see {@link ManifestDiff}. */
export interface ArtifactDiffEntry<T> {
  id: string;
  /** Absent if this id wasn't installed before (new in `next`). */
  from?: T;
  /** Absent if this id dropped out of `next` (removed/deprecated away since `installed`). */
  to?: T;
  changed: boolean;
}

/**
 * Result of comparing a freshly fetched manifest against what's installed —
 * TZ §5.4, extended to `models[]`/`embeddings[]` arrays by the multi-model
 * plan §5. Model and embedding changes are still reported independently: a
 * consumer can react to `embeddingChanged` without necessarily re-pulling
 * the (much larger) models, and vice versa. Produced by `ManifestService`,
 * never started automatically — TZ §5.4: "Скачивание не стартует
 * автоматически по факту diff".
 *
 * `modelChanged`/`embeddingChanged` are kept as top-level booleans for
 * callers that only care *whether* something changed, not the per-model
 * detail — equivalent to `models.some(m => m.changed)` /
 * `embeddings.some(e => e.changed)`.
 */
export interface ManifestDiff {
  modelChanged: boolean;
  embeddingChanged: boolean;
  models: ArtifactDiffEntry<ModelArtifact>[];
  embeddings: ArtifactDiffEntry<EmbeddingArtifact>[];
}

/**
 * Compares `next[]` against `installed[]` by id (TZ §5.4's "сравнить
 * installed.modelVersion / installed.embeddingVersion", per-artifact once
 * there's more than one). `installed` is whatever the caller currently
 * considers the source of truth for "what's on this device":
 * `ModelRegistry`'s `installed_artifacts` rows once that's wired (Phase
 * 2/5), or — until then — `ManifestService` passing the previously cached
 * manifest's artifacts as a best-effort stand-in (nothing is actually
 * installed yet in that case, so a missing `from` still correctly reports
 * `changed: true`).
 *
 * Changed = different `version` for the same `id`, or the id is only on
 * one side (new in `next`, or dropped since `installed`) — a same-id
 * version bump and a full appear/disappear are both "changed", alike;
 * callers that care about the distinction can inspect `from`/`to`
 * themselves. Order: `next`'s array order first, then any `installed`-only
 * (removed) ids appended after.
 */
function diffArtifacts<T extends { id: string; version: number }>(
  next: T[],
  installed: T[] | undefined,
): ArtifactDiffEntry<T>[] {
  const installedById = new Map((installed ?? []).map((a) => [a.id, a] as const));
  const nextById = new Map(next.map((a) => [a.id, a] as const));
  const orderedIds = [...nextById.keys(), ...[...installedById.keys()].filter((id) => !nextById.has(id))];

  return orderedIds.map((id) => {
    const from = installedById.get(id);
    const to = nextById.get(id);
    const changed = !from || !to || from.version !== to.version;
    return { id, from, to, changed };
  });
}

export function diffManifest(
  next: { models: ModelArtifact[]; embeddings: EmbeddingArtifact[] },
  installed: { models?: ModelArtifact[]; embeddings?: EmbeddingArtifact[] },
): ManifestDiff {
  const models = diffArtifacts(next.models, installed.models);
  const embeddings = diffArtifacts(next.embeddings, installed.embeddings);

  return {
    modelChanged: models.some((m) => m.changed),
    embeddingChanged: embeddings.some((e) => e.changed),
    models,
    embeddings,
  };
}
