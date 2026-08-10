import type { EmbeddingArtifact, ModelArtifact } from './manifest.schema.js';

/**
 * Resolves the actual HTTPS download URL for a manifest artifact — TZ §5.2/§14.
 * Model artifacts (`HuggingFaceSource`) use HF's standard pinned-revision
 * file URL (`/resolve/<revision>/<file>`, never `/resolve/main/...` — the
 * manifest validator already rejects `"main"`/`"HEAD"`/empty revisions
 * before this ever runs, so `source.revision` here is always a concrete
 * commit SHA). Embedding artifacts (`UrlSource`) already carry an
 * arbitrary HTTPS URL directly — validated `https://`-only the same way.
 */
export function resolveArtifactUrl(artifact: ModelArtifact | EmbeddingArtifact): string {
  if (artifact.source.type === 'huggingface') {
    const { repo, revision, file } = artifact.source;
    return `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
  }
  return artifact.source.url;
}
