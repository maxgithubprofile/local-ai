/**
 * Independent embedding update, deliberately without touching the model —
 * TZ §5.6, `docs/guides/independent-model-embedding-updates.md`.
 */
import { getClient } from './local-ai-setup.js';

export async function checkForEmbeddingUpdate(): Promise<void> {
  const client = await getClient();

  client.on('vector-store:embedding-changed', ({ previous, current, dimensionsChanged }) => {
    console.log(`embedding changed: ${previous?.id ?? '(none)'} -> ${current.id}`, { dimensionsChanged });
    if (dimensionsChanged) {
      // A same-dimension embedder version is still not guaranteed to share
      // a vector space, so local-ai never auto-reindexes — but a *known*
      // dimension change is an even stronger signal your app should show a
      // "rebuilding search index…" UI before calling vectors.reindex()
      // (and re-embedding/re-upserting whatever this app stores vectors for).
      console.log('Dimensions changed — a reindex + re-embed pass is required, not automatic.');
    }
  });

  const diff = await client.refreshManifest();

  if (diff.embeddingChanged && !diff.modelChanged) {
    console.log(`Embedding update available: ${diff.embedding.from?.version ?? '(new)'} -> ${diff.embedding.to.version}`);
    await client.switchEmbedding({
      onProgress: (p) => console.log(`downloading embedding: ${p.percent}%`),
    });
    console.log('Embedding updated; model untouched — no chat needed to reload.');
  } else if (!diff.embeddingChanged) {
    console.log('Embedding already up to date.');
  }
}
