/**
 * Manifest schema — TZ §5.2. Model and embedding are independent top-level
 * artifacts with independent version histories; compatibility is declared
 * explicitly via `EmbeddingArtifact.compatibleModelIds` rather than assumed
 * from co-location in the manifest. See TZ §5.1 for the rationale and
 * `manifest.service.ts` (Phase 1) for the validation rules from this
 * section (pinned revision, https-only embedding URL, hash format, etc).
 */
export interface LocalAiManifest {
  manifestVersion: number;
  publishedAt: string;
  model: ModelArtifact;
  embedding: EmbeddingArtifact;
  previousModels?: ModelArtifact[];
  previousEmbeddings?: EmbeddingArtifact[];
}

export interface ModelArtifact {
  id: string;
  version: number;
  displayName: string;
  family: string;
  /** Billions of parameters, e.g. 4. */
  paramsB: number;
  /** GGUF quantization label, e.g. `"Q4_K_M"`. */
  quant: string;
  languages: 'multilingual';
  contextLength: number;
  source: HuggingFaceSource;
  /** Convention: `model__<id>__v<version>.gguf`. */
  filename: string;
  sha256: string;
  sizeBytes: number;
  /** Eligibility thresholds — mandatory fields, not code constants. See TZ §6.2. */
  minRamGb: number;
  recommendedRamGb: number;
  /**
   * `'auto'` (default) trusts the GGUF's embedded `tokenizer.chat_template`
   * (or the native runtime plugin applying it). An explicit preset is the
   * fallback when the model/plugin doesn't carry a usable template. TZ §4.1.
   */
  chatTemplate: 'auto' | 'qwen' | 'llama3' | 'gemma' | 'mistral' | 'raw';
  status: 'active' | 'deprecated';
}

export interface EmbeddingArtifact {
  id: string;
  /** Grows independently of `ModelArtifact.version` — TZ §5.1. */
  version: number;
  compatibleModelIds: string[];
  dimensions: number;
  source: UrlSource;
  /** Convention: `embedding__<id>__v<version>.gguf`. */
  filename: string;
  sha256: string;
  sizeBytes: number;
  minRamGb: number;
  recommendedRamGb: number;
  status: 'active' | 'deprecated';
}

export interface HuggingFaceSource {
  type: 'huggingface';
  repo: string;
  /** Must be a pinned commit SHA — `"main"`/`"HEAD"`/empty is rejected by validation. */
  revision: string;
  file: string;
}

export interface UrlSource {
  type: 'url';
  /** Arbitrary HTTPS URL — validation rejects non-`https://` sources. */
  url: string;
}
