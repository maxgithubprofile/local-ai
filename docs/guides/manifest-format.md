# Manifest format

`LocalAiConfig.manifestUrl` must serve a JSON document matching `LocalAiManifest` (exported from
`local-ai`). `models`/`embeddings` are **arrays**, each entry an independent artifact — bumping one
model's `version` never implies anything about another model or about any embedding (TZ §5.1). This
replaces an earlier singular `model`/`embedding` shape (`models[]`/`embeddings[]` landed 2026-08-21,
`docs/plans/llama2/2026-08-21-multi-model-selection-plan.md` §3) — a device that can't run the flagship
model still needs *some* option, and a desktop build usually offers a different, larger set of options
than a phone build **in the same manifest**, not a separate schema (see "Desktop vs. mobile" below).

```jsonc
{
  "manifestVersion": 1,
  "publishedAt": "2026-08-10T00:00:00.000Z",
  "models": [
    {
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
      "status": "active",               // 'active' | 'deprecated'
      "recommended": true               // publisher's default pick — at most one model may set this
    },
    {
      "id": "qwen-14b",
      "version": 1,
      "displayName": "Qwen 2.5 14B Instruct",
      "family": "qwen",
      "paramsB": 14,
      "quant": "Q4_K_M",
      "languages": "multilingual",
      "contextLength": 32768,
      "source": {
        "type": "huggingface",
        "repo": "org/qwen2.5-14b-instruct-gguf",
        "revision": "b2c3d4e5f6a1...",
        "file": "qwen2.5-14b-instruct-q4_k_m.gguf"
      },
      "filename": "model__qwen-14b__v1.gguf",
      "sha256": "…64 lowercase hex chars…",
      "sizeBytes": 9000000000,
      "minRamGb": 14,
      "recommendedRamGb": 24,
      "chatTemplate": "auto",
      "status": "active"
    }
  ],
  "embeddings": [
    {
      "id": "bge-small",
      "version": 1,
      "compatibleModelIds": ["qwen-4b", "qwen-14b"],
      "dimensions": 384,
      "source": { "type": "url", "url": "https://your-cdn.example.com/embedding.gguf" }, // https:// only
      "filename": "embedding__bge-small__v1.gguf",
      "sha256": "…64 lowercase hex chars…",
      "sizeBytes": 100000000,
      "minRamGb": 1,
      "recommendedRamGb": 2,
      "status": "active"
    }
  ],
  "previousModels": [],     // optional, recommended max 1 entry per id
  "previousEmbeddings": []  // optional, recommended max 1 entry per id
}
```

## Desktop vs. mobile — one manifest, no separate schema

There is no `platform`-scoped section of the manifest and no Electron-specific artifact type — a
desktop build simply has more RAM to work with, so `EligibilityService` (TZ §6.2) naturally passes
larger `models[]`/`embeddings[]` entries as `'ok'` that a phone-class device would score `'no'` or
`'tight'` on. The `qwen-14b` entry above (`minRamGb: 14`) is a realistic "desktop-class" example next to
`qwen-4b`'s "runs everywhere" entry — both ship in the same manifest; each client (mobile or Electron)
just sees a different subset pass eligibility. Don't set `recommended: true` on the larger entry unless
you actually want it as everyone's default regardless of device class — the flag doesn't take device
class into account, it's a flat publisher pick (`ModelArtifact.recommended`'s doc comment).

## Validation rules (`ManifestService`, TZ §5.2)

A manifest failing *any* of these is rejected wholesale — `local-ai` keeps serving the last-known-good
cached manifest and emits `manifest:invalid` rather than partially applying a bad one:

- `models[].source.revision` must be a pinned commit SHA — `"main"`, `"HEAD"`, or empty is rejected (TZ
  §14's non-negotiable security invariant: never trust a floating ref).
- `embeddings[].source.url` must start with `https://`.
- `embeddings[].compatibleModelIds` must include at least one real `models[].id`.
- `models[].sha256`/`embeddings[].sha256` must be valid 64-character hex strings.
- `models[].filename`/`embeddings[].filename` must be a safe basename — no `/`, `\`, `..`, and must
  match `^[A-Za-z0-9][A-Za-z0-9._-]*\.gguf$` (SEC.1 — rejects path traversal from a compromised/MITM'd
  manifest host).
- `models[].sizeBytes`/`embeddings[].sizeBytes` must be `> 0`.
- `models[].paramsB` must be `<= maxModelParamsB` (`LocalAiConfig.maxModelParamsB`, default `4` — raise
  this explicitly in your config if you're shipping larger desktop-class models like `qwen-14b` above,
  or that entry is silently dropped, not an error).
- `minRamGb > 0` and `recommendedRamGb >= minRamGb`, for every model and embedding entry.
- At most one entry in `models[]` may have `recommended: true`.

## Choosing `minRamGb`/`recommendedRamGb`

These are **manifest fields, not library constants** — you calibrate them per artifact, not `local-ai`.
TZ §6.2's starting point for a 4B Q4_K_M model (~2.2–2.9GB file): `minRamGb: 4`, `recommendedRamGb: 8`.
General formula for other sizes: `minRamGb ≈ ceil(sizeGB × 1.5)`, `recommendedRamGb ≈ ceil(sizeGB × 2.5)`
— weights + KV-cache at a typical context length + headroom for the OS and host app. Treat these as a
starting point to calibrate against real devices, not a guarantee — mobile thresholds are the TZ §6.2
starting point; desktop-class thresholds have no calibrated real-hardware data yet either
(`ROADMAP.md`'s ELEC.3.2, blocked on physical desktop hardware access, same shape as the mobile
calibration gap `docs/guides/support-and-eligibility.md` already documents).

## Caching

The whole manifest is cached with its `ETag` (SQL `kv_store`, TZ §8.1) — `refreshManifest()` sends
`If-None-Match` and treats a `304` as "nothing changed" without re-validating. `local-ai` never picks
between multiple candidate models on its own beyond `recommended`/eligibility filtering — it's still the
host app's job to build a model-picker UI over `models[]` if it wants one (TZ §5.1).
