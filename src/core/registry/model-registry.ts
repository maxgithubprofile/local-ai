import type { SqlitePort, SqliteRow } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';

/** One row of `installed_artifacts` (TZ §8.1), decoded. */
export interface InstalledArtifact {
  id: string;
  version: number;
  filename: string;
  sha256: string;
  sizeBytes: number;
  /** Only meaningful for `kind: 'embedding'` — migration 003. */
  dimensions?: number;
}

interface InstalledArtifactRow extends SqliteRow {
  artifact_id: string;
  version: number;
  filename: string;
  sha256: string;
  size_bytes: number;
  dimensions: number | null;
}

/**
 * Tracks `installed_artifacts` (current + previous per kind, TZ §5.3) —
 * the source of truth `LocalAiClient.switchModel()`/`switchEmbedding()`
 * (Phase 5, TZ §5.5/§5.6) use to know which file to delete after a switch
 * and what the *previous* embedding looked like for the public
 * `vector-store:embedding-changed` event. Never touches the filesystem or
 * the runtime itself — purely bookkeeping, by design (TZ §5.5/§5.6's steps
 * keep "update the registry" and "delete the old file" as separate,
 * independently-orderable actions).
 */
export class ModelRegistry {
  constructor(
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
  ) {}

  async getCurrent(kind: 'model' | 'embedding'): Promise<InstalledArtifact | null> {
    const rows = await this.sqlite.query<InstalledArtifactRow>(
      'SELECT * FROM installed_artifacts WHERE kind = ? AND is_current = 1',
      [kind],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.artifact_id,
      version: row.version,
      filename: row.filename,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      dimensions: row.dimensions ?? undefined,
    };
  }

  /**
   * Marks `artifact` as current for `kind`, demoting whatever was current
   * before. Returns the previous current row (if any) so the caller can
   * decide what to do with its file — this method never deletes anything
   * itself.
   */
  async setCurrent(kind: 'model' | 'embedding', artifact: InstalledArtifact): Promise<{ previous: InstalledArtifact | null }> {
    const previous = await this.getCurrent(kind);
    await this.sqlite.transaction(async (tx) => {
      await tx.execute('UPDATE installed_artifacts SET is_current = 0 WHERE kind = ? AND is_current = 1', [kind]);
      await tx.execute(
        `INSERT INTO installed_artifacts (kind, artifact_id, version, filename, sha256, size_bytes, installed_at, is_current, dimensions)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(kind, artifact_id, version) DO UPDATE SET
           filename = excluded.filename,
           sha256 = excluded.sha256,
           size_bytes = excluded.size_bytes,
           is_current = 1,
           dimensions = excluded.dimensions`,
        [kind, artifact.id, artifact.version, artifact.filename, artifact.sha256, artifact.sizeBytes, this.clock.nowIso(), artifact.dimensions ?? null],
      );
    });
    return { previous };
  }
}
