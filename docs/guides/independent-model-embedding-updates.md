# Independent model/embedding updates

The manifest carries the model and the embedding as two **independent** top-level artifacts, each
with its own version history (TZ §5.1) — bumping one never implies anything about the other.

## Checking for updates

```ts
const diff = await client.refreshManifest();
// diff.modelChanged / diff.embeddingChanged — independent booleans
// diff.model.from (undefined on first-ever fetch) / diff.model.to
```

`refreshManifest()` never starts a download by itself — it fetches (with `If-None-Match`, so an
unchanged manifest is a cheap `304`), validates, caches, and reports what changed. You decide whether
and when to act on the diff (e.g. prompt the user, or only update over wifi).

## Updating the model

```ts
if (diff.modelChanged) {
  await client.switchModel({ onProgress: (p) => updateProgressBar(p.percent) });
}
```

In order (TZ §5.5), all handled for you: eligibility check against the *new* model → download + verify
sha256 → release **only** the LLM context (the embedding context, if loaded, is untouched) → register
the new model as current → delete the old model file from disk → invalidate every session-cache file
(their KV content is tied to the exact old weights, so they'd be worse than useless afterward) →
reload the new model. `runtime:unloaded` fires with `reason: 'model-switch'` partway through if you
want to show a "reloading…" state.

## Updating the embedding

```ts
if (diff.embeddingChanged) {
  await client.switchEmbedding({ onProgress: (p) => updateProgressBar(p.percent) });
}

client.on('vector-store:embedding-changed', ({ previous, current, dimensionsChanged }) => {
  // local-ai does NOT delete or recompute your existing vectors here, even if
  // dimensionsChanged is false — a same-dimension embedder version is not
  // guaranteed to share the same vector space.
});
```

Same independent-release discipline as the model, mirrored for the embedding context. The important
part: **`switchEmbedding()` never touches your stored vectors.** From that point on,
`client.vectors.upsert()`/`.search()` compare the active embedding against what's recorded in
`vector_space` and throw `VectorSpaceMismatchError` on any mismatch, rather than silently searching
against a stale space. The only way past that guard is an explicit, conscious
`client.vectors.reindex()` (wipes stored vectors, adopts the new space) — there is no automatic
migration path, by design (TZ §5.6/§8.2/§8.3).

## What neither switch touches

Chat history in SQL, `download_state` for in-progress *other* downloads, and (for `switchModel()`
specifically) the embedding file/context, and vice versa. Each switch's file deletion only ever
targets its own artifact kind's old file.
