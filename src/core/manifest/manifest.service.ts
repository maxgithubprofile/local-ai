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
 * Full validation rule list from TZ §5.2. Structural shape is checked
 * loosely (this is a hand-rolled guard, not a schema library — the fields
 * actually consulted are checked; unrelated extra fields are ignored) so a
 * manifest failing one rule still gets *every* other rule's error reported
 * at once rather than stopping at the first `TypeError`.
 */
export function validateManifest(body: unknown, maxModelParamsB: number): ManifestValidationResult {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { ok: false, errors: ['manifest is not an object'] };
  }
  const m = body as Partial<LocalAiManifest>;

  if (typeof m.manifestVersion !== 'number') errors.push('manifestVersion is missing or not a number');
  if (typeof m.publishedAt !== 'string') errors.push('publishedAt is missing or not a string');

  const model = m.model as Partial<ModelArtifact> | undefined;
  if (!model || typeof model !== 'object') {
    errors.push('model is missing');
  } else {
    if (!model.id) errors.push('model.id is missing');
    if (typeof model.version !== 'number') errors.push('model.version is missing or not a number');
    if (typeof model.paramsB !== 'number' || model.paramsB > maxModelParamsB) {
      errors.push(`model.paramsB must be a number <= maxModelParamsB (${maxModelParamsB})`);
    }
    if (!model.filename || !isSafeFilename(model.filename)) {
      errors.push('model.filename must be a bare basename matching ^[A-Za-z0-9][A-Za-z0-9._-]*\\.gguf$ with no path separators or ".."');
    }
    if (!model.sha256 || !HEX64.test(model.sha256)) errors.push('model.sha256 is not a valid hex64 string');
    if (typeof model.sizeBytes !== 'number' || model.sizeBytes <= 0) errors.push('model.sizeBytes must be > 0');
    if (typeof model.minRamGb !== 'number' || model.minRamGb <= 0) errors.push('model.minRamGb must be > 0');
    if (typeof model.recommendedRamGb !== 'number' || model.recommendedRamGb < (model.minRamGb ?? Infinity)) {
      errors.push('model.recommendedRamGb must be >= model.minRamGb');
    }
    const revision = model.source?.type === 'huggingface' ? model.source.revision : undefined;
    if (!revision || revision === 'main' || revision === 'HEAD') {
      errors.push('model.source.revision must be a pinned commit SHA, not "main"/"HEAD"/empty');
    }
  }

  const embedding = m.embedding as Partial<EmbeddingArtifact> | undefined;
  if (!embedding || typeof embedding !== 'object') {
    errors.push('embedding is missing');
  } else {
    if (!embedding.id) errors.push('embedding.id is missing');
    if (typeof embedding.version !== 'number') errors.push('embedding.version is missing or not a number');
    if (!embedding.filename || !isSafeFilename(embedding.filename)) {
      errors.push('embedding.filename must be a bare basename matching ^[A-Za-z0-9][A-Za-z0-9._-]*\\.gguf$ with no path separators or ".."');
    }
    if (!embedding.sha256 || !HEX64.test(embedding.sha256)) errors.push('embedding.sha256 is not a valid hex64 string');
    if (typeof embedding.sizeBytes !== 'number' || embedding.sizeBytes <= 0) errors.push('embedding.sizeBytes must be > 0');
    if (typeof embedding.minRamGb !== 'number' || embedding.minRamGb <= 0) errors.push('embedding.minRamGb must be > 0');
    if (
      typeof embedding.recommendedRamGb !== 'number' ||
      embedding.recommendedRamGb < (embedding.minRamGb ?? Infinity)
    ) {
      errors.push('embedding.recommendedRamGb must be >= embedding.minRamGb');
    }
    const url = embedding.source?.type === 'url' ? embedding.source.url : undefined;
    if (!url || !url.startsWith('https://')) errors.push('embedding.source.url must be an https:// URL');
    if (model?.id && !embedding.compatibleModelIds?.includes(model.id)) {
      errors.push('embedding.compatibleModelIds must include model.id');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: m as LocalAiManifest };
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
