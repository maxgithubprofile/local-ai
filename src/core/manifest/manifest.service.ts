import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import { ManifestFetchError, ManifestValidationError } from '../errors.js';
import type { EmbeddingArtifact, LocalAiManifest, ModelArtifact } from './manifest.schema.js';
import { diffManifest, type ManifestDiff } from './manifest.diff.js';

const KV_KEY_MANIFEST = 'manifest:cached';
const KV_KEY_ETAG = 'manifest:etag';

const HEX64 = /^[a-f0-9]{64}$/i;

/**
 * Strict basename check for `model.filename`/`embedding.filename` (SEC.1,
 * `docs/decisions.md`'s "Security audit (2026-08-11)" section). Both fields
 * flow unchecked from the network into `FileSystemPort.resolvePath()`
 * (`download-engine.ts`, `local-ai-client.ts`'s old-file cleanup), and
 * `resolvePath()` itself documents that it trusts its caller rather than
 * sandboxing against `../` — so this is the actual place a path-traversal
 * write primitive gets closed, not the adapter layer. No `/`, `\`, or `..`,
 * must be a bare `<safe-chars>.gguf` basename.
 */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.gguf$/;

function isSafeFilename(filename: string): boolean {
  return SAFE_FILENAME.test(filename) && !filename.includes('..');
}

/** Result of {@link validateManifest} — either a narrowed, trustworthy manifest, or the list of rules it failed. */
export type ManifestValidationResult = { ok: true; manifest: LocalAiManifest } | { ok: false; errors: string[] };

/**
 * Full validation rule list from TZ §5.2, extended for `models[]`/
 * `embeddings[]` arrays by the multi-model plan §4. Structural shape is
 * checked loosely (this is a hand-rolled guard, not a schema library — the
 * fields actually consulted are checked; unrelated extra fields are
 * ignored) so a manifest failing one rule still gets *every* other rule's
 * error reported at once rather than stopping at the first `TypeError`.
 * Errors reference their array index (`models[1].sha256 is not...`) so a
 * manifest with several models points at exactly which one is broken.
 *
 * `maxModelParamsB` semantics for a multi-model manifest (plan §4/§12.2,
 * decided over the single-model original "whole manifest rejected"
 * behavior): a model over the cap is silently **excluded** from the
 * validated `models[]` — one oversized model must not take down every
 * lighter model published alongside it. It is not a validation error by
 * itself; the manifest only fails if *no* model remains after the filter.
 */
export function validateManifest(body: unknown, maxModelParamsB: number): ManifestValidationResult {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { ok: false, errors: ['manifest is not an object'] };
  }
  const m = body as Partial<LocalAiManifest>;

  if (typeof m.manifestVersion !== 'number') errors.push('manifestVersion is missing or not a number');
  if (typeof m.publishedAt !== 'string') errors.push('publishedAt is missing or not a string');

  const modelsRaw = m.models;
  if (!Array.isArray(modelsRaw) || modelsRaw.length === 0) {
    errors.push('models must be a non-empty array');
  }
  const recommendedCount = Array.isArray(modelsRaw)
    ? modelsRaw.filter((raw) => (raw as Partial<ModelArtifact> | undefined)?.recommended === true).length
    : 0;
  if (recommendedCount > 1) errors.push('at most one entry in models[] may have recommended: true');

  const validModels: ModelArtifact[] = [];
  const seenModelIds = new Set<string>();
  if (Array.isArray(modelsRaw)) {
    modelsRaw.forEach((raw, i) => {
      const model = raw as Partial<ModelArtifact> | undefined;
      if (!model || typeof model !== 'object') {
        errors.push(`models[${i}] is missing or not an object`);
        return;
      }
      if (typeof model.paramsB !== 'number') {
        errors.push(`models[${i}].paramsB must be a number`);
        return;
      }
      if (model.paramsB > maxModelParamsB) {
        return; // over the cap — excluded from models[], not a manifest-wide error (plan §4/§12.2)
      }

      const fieldErrors: string[] = [];
      if (!model.id) fieldErrors.push(`models[${i}].id is missing`);
      else if (seenModelIds.has(model.id)) fieldErrors.push(`models[${i}].id "${model.id}" is duplicated`);
      if (typeof model.version !== 'number') fieldErrors.push(`models[${i}].version is missing or not a number`);
      if (!model.filename || !isSafeFilename(model.filename)) {
        fieldErrors.push(`models[${i}].filename must be a bare basename matching ^[A-Za-z0-9][A-Za-z0-9._-]*\\.gguf$ with no path separators or ".."`);
      }
      if (!model.sha256 || !HEX64.test(model.sha256)) fieldErrors.push(`models[${i}].sha256 is not a valid hex64 string`);
      if (typeof model.sizeBytes !== 'number' || model.sizeBytes <= 0) fieldErrors.push(`models[${i}].sizeBytes must be > 0`);
      if (typeof model.minRamGb !== 'number' || model.minRamGb <= 0) fieldErrors.push(`models[${i}].minRamGb must be > 0`);
      if (typeof model.recommendedRamGb !== 'number' || model.recommendedRamGb < (model.minRamGb ?? Infinity)) {
        fieldErrors.push(`models[${i}].recommendedRamGb must be >= models[${i}].minRamGb`);
      }
      const revision = model.source?.type === 'huggingface' ? model.source.revision : undefined;
      if (!revision || revision === 'main' || revision === 'HEAD') {
        fieldErrors.push(`models[${i}].source.revision must be a pinned commit SHA, not "main"/"HEAD"/empty`);
      }

      if (model.id) seenModelIds.add(model.id);
      errors.push(...fieldErrors);
      if (fieldErrors.length === 0) validModels.push(model as ModelArtifact);
    });
    if (modelsRaw.length > 0 && validModels.length === 0 && errors.length === 0) {
      // Every entry was individually well-formed but excluded by the
      // paramsB cap — distinct from "models must be a non-empty array"
      // (that fires on a genuinely empty/missing array), and from a
      // per-field error above (already reported by index there).
      errors.push(`no model in models[] is within maxModelParamsB (${maxModelParamsB}) after excluding oversized entries`);
    }
  }

  const embeddingsRaw = m.embeddings;
  if (!Array.isArray(embeddingsRaw) || embeddingsRaw.length === 0) {
    errors.push('embeddings must be a non-empty array');
  }
  const validEmbeddings: EmbeddingArtifact[] = [];
  const seenEmbeddingIds = new Set<string>();
  if (Array.isArray(embeddingsRaw)) {
    embeddingsRaw.forEach((raw, i) => {
      const embedding = raw as Partial<EmbeddingArtifact> | undefined;
      if (!embedding || typeof embedding !== 'object') {
        errors.push(`embeddings[${i}] is missing or not an object`);
        return;
      }
      const fieldErrors: string[] = [];
      if (!embedding.id) fieldErrors.push(`embeddings[${i}].id is missing`);
      else if (seenEmbeddingIds.has(embedding.id)) fieldErrors.push(`embeddings[${i}].id "${embedding.id}" is duplicated`);
      if (typeof embedding.version !== 'number') fieldErrors.push(`embeddings[${i}].version is missing or not a number`);
      if (!embedding.filename || !isSafeFilename(embedding.filename)) {
        fieldErrors.push(`embeddings[${i}].filename must be a bare basename matching ^[A-Za-z0-9][A-Za-z0-9._-]*\\.gguf$ with no path separators or ".."`);
      }
      if (!embedding.sha256 || !HEX64.test(embedding.sha256)) fieldErrors.push(`embeddings[${i}].sha256 is not a valid hex64 string`);
      if (typeof embedding.sizeBytes !== 'number' || embedding.sizeBytes <= 0) fieldErrors.push(`embeddings[${i}].sizeBytes must be > 0`);
      if (typeof embedding.minRamGb !== 'number' || embedding.minRamGb <= 0) fieldErrors.push(`embeddings[${i}].minRamGb must be > 0`);
      if (
        typeof embedding.recommendedRamGb !== 'number' ||
        embedding.recommendedRamGb < (embedding.minRamGb ?? Infinity)
      ) {
        fieldErrors.push(`embeddings[${i}].recommendedRamGb must be >= embeddings[${i}].minRamGb`);
      }
      const url = embedding.source?.type === 'url' ? embedding.source.url : undefined;
      if (!url || !url.startsWith('https://')) fieldErrors.push(`embeddings[${i}].source.url must be an https:// URL`);
      if (!Array.isArray(embedding.compatibleModelIds) || embedding.compatibleModelIds.length === 0) {
        fieldErrors.push(`embeddings[${i}].compatibleModelIds must be a non-empty array`);
      }

      if (embedding.id) seenEmbeddingIds.add(embedding.id);
      errors.push(...fieldErrors);
      if (fieldErrors.length === 0) validEmbeddings.push(embedding as EmbeddingArtifact);
    });
  }

  // Cross-check (TZ §4's extension): every *active* model must have at
  // least one *active* embedding declaring compatibility with it — a
  // missing pairing is a publish-time error, not something
  // ensureEmbeddingReady() should discover on-device at runtime. A
  // deprecated model isn't held to this (TZ §5.1 — deprecated artifacts
  // aren't expected to stay downloadable).
  for (const model of validModels) {
    if (model.status !== 'active') continue;
    const hasCompatibleEmbedding = validEmbeddings.some(
      (e) => e.status === 'active' && e.compatibleModelIds.includes(model.id),
    );
    if (!hasCompatibleEmbedding) {
      errors.push(`no active embeddings[] entry declares compatibleModelIds including active model "${model.id}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: { ...m, models: validModels, embeddings: validEmbeddings } as LocalAiManifest };
}

/**
 * Fetches the manifest from `manifestUrl` (`If-None-Match` against the
 * cached `ETag`, TZ §5.3), validates it (`validateManifest` above), caches
 * it + its `ETag` in `kv_store`, and produces a {@link ManifestDiff} via
 * `manifest.diff.ts`. On a fetch or validation failure this **throws**
 * (`ManifestFetchError`/`ManifestValidationError`) — the previously cached
 * manifest is left untouched and still readable via
 * {@link ManifestService.getCachedManifest}. Translating that throw into
 * the public `manifest:invalid` event (TZ §5.2) instead of letting it
 * escape `LocalAiClient.refreshManifest()` is `LocalAiClient`'s job, not
 * this class's — this class's contract is "reject with a typed error",
 * nothing more.
 *
 * `installed` for {@link diffManifest} purposes is, until `ModelRegistry`'s
 * read side exists (Phase 2/5), the *previously cached* manifest's
 * artifacts — see `manifest.diff.ts`'s doc comment for why that's a safe
 * stand-in.
 */
export class ManifestService {
  constructor(
    private readonly manifestUrl: string,
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
    private readonly maxModelParamsB: number = 4,
  ) {}

  async refresh(): Promise<{ manifest: LocalAiManifest; diff: ManifestDiff; notModified: boolean }> {
    const cached = await this.getCachedManifest();
    const cachedEtag = await this.getKv(KV_KEY_ETAG);

    let response: Response;
    try {
      response = await fetch(this.manifestUrl, {
        headers: cachedEtag ? { 'If-None-Match': cachedEtag } : undefined,
      });
    } catch (err) {
      throw new ManifestFetchError(`failed to fetch manifest from ${this.manifestUrl}: ${(err as Error).message}`, {
        cause: err,
      });
    }

    if (response.status === 304) {
      if (!cached) {
        throw new ManifestFetchError('server returned 304 Not Modified but no manifest is cached locally');
      }
      return { manifest: cached, diff: diffManifest(cached, cached), notModified: true };
    }

    if (!response.ok) {
      throw new ManifestFetchError(`manifest fetch failed with HTTP ${response.status} ${response.statusText}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new ManifestFetchError('manifest response body is not valid JSON', { cause: err as Error });
    }

    const validation = validateManifest(body, this.maxModelParamsB);
    if (!validation.ok) {
      throw new ManifestValidationError(`manifest failed validation: ${validation.errors.join('; ')}`);
    }

    const manifest = validation.manifest;
    const diff = diffManifest(manifest, cached ?? {});
    await this.persist(manifest, response.headers.get('etag'));

    return { manifest, diff, notModified: false };
  }

  async getCachedManifest(): Promise<LocalAiManifest | null> {
    const raw = await this.getKv(KV_KEY_MANIFEST);
    return raw ? (JSON.parse(raw) as LocalAiManifest) : null;
  }

  private async persist(manifest: LocalAiManifest, etag: string | null): Promise<void> {
    await this.setKv(KV_KEY_MANIFEST, JSON.stringify(manifest));
    if (etag) await this.setKv(KV_KEY_ETAG, etag);
  }

  private async getKv(key: string): Promise<string | null> {
    const rows = await this.sqlite.query<{ value: string }>('SELECT value FROM kv_store WHERE key = ?', [key]);
    return rows[0]?.value ?? null;
  }

  private async setKv(key: string, value: string): Promise<void> {
    await this.sqlite.execute(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, this.clock.nowIso()],
    );
  }
}
