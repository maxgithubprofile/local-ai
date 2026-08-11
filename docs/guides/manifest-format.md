# Manifest format

`LocalAiConfig.manifestUrl` must serve a JSON document matching `LocalAiManifest` (exported from
`local-ai`). Model and embedding are independent top-level artifacts — bumping one's `version` never
implies anything about the other (TZ §5.1).

```jsonc
{
  "manifestVersion": 1,
  "publishedAt": "2026-08-10T00:00:00.000Z",
  "model": {
    "id": "qwen-4b",
    "version": 1,
    "displayName": "Qwen 2.5 4B Instruct",
    "family": "qwen",
    "paramsB": 4,
    "quant": "Q4_K_M",
    "languages": "multilingual",
    "contextLength": 8192,
    "source": {
      "type": "huggingface",
      "repo": "org/qwen2.5-4b-instruct-gguf",
      "revision": "a1b2c3d4e5f6...",   // a pinned commit SHA — "main"/"HEAD"/empty is rejected
      "file": "qwen2.5-4b-instruct-q4_k_m.gguf"
    },
    "filename": "model__qwen-4b__v1.gguf",  // convention: model__<id>__v<version>.gguf
    "sha256": "…64 lowercase hex chars…",
    "sizeBytes": 2500000000,
    "minRamGb": 4,
    "recommendedRamGb": 8,
    "chatTemplate": "auto",           // 'auto' | 'qwen' | 'llama3' | 'gemma' | 'mistral' | 'raw'
    "status": "active"                // 'active' | 'deprecated'
  },
  "embedding": {
    "id": "bge-small",
    "version": 1,
    "compatibleModelIds": ["qwen-4b"], // must include model.id
    "dimensions": 384,
    "source": { "type": "url", "url": "https://your-cdn.example.com/embedding.gguf" }, // https:// only
    "filename": "embedding__bge-small__v1.gguf",
    "sha256": "…64 lowercase hex chars…",
    "sizeBytes": 100000000,
    "minRamGb": 1,
    "recommendedRamGb": 2,
    "status": "active"
  },
  "previousModels": [],     // optional, recommended max 1 entry
  "previousEmbeddings": []  // optional, recommended max 1 entry
}
```

## Validation rules (`ManifestService`, TZ §5.2)

A manifest failing *any* of these is rejected wholesale — `local-ai` keeps serving the last-known-good
cached manifest and emits `manifest:invalid` rather than partially applying a bad one:

- `model.source.revision` must be a pinned commit SHA — `"main"`, `"HEAD"`, or empty is rejected (TZ
  §14's non-negotiable security invariant: never trust a floating ref).
- `embedding.source.url` must start with `https://`.
- `embedding.compatibleModelIds` must include `model.id`.
- `model.sha256`/`embedding.sha256` must be valid 64-character hex strings.
- `model.sizeBytes`/`embedding.sizeBytes` must be `> 0`.
- `model.paramsB` must be `<= maxModelParamsB` (`LocalAiConfig.maxModelParamsB`, default `4`).
- `minRamGb > 0` and `recommendedRamGb >= minRamGb`, for both artifacts.

## Choosing `minRamGb`/`recommendedRamGb`

These are **manifest fields, not library constants** — you calibrate them per artifact, not `local-ai`.
TZ §6.2's starting point for a 4B Q4_K_M model (~2.2–2.9GB file): `minRamGb: 4`, `recommendedRamGb: 8`.
General formula for other sizes: `minRamGb ≈ ceil(sizeGB × 1.5)`, `recommendedRamGb ≈ ceil(sizeGB × 2.5)`
— weights + KV-cache at a typical context length + headroom for the OS and host app. Treat these as a
starting point to calibrate against real devices, not a guarantee.

## Caching

The whole manifest is cached with its `ETag` (SQL `kv_store`, TZ §8.1) — `refreshManifest()` sends
`If-None-Match` and treats a `304` as "nothing changed" without re-validating. `local-ai` never picks
between multiple candidate models on its own; it just follows whatever the manifest says.
