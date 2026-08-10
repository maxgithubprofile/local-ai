/**
 * Not implemented — Phase 1/2 (ROADMAP.md). Tracks `installed_artifacts`
 * (current + at most one previous per kind, TZ §5.3) and drives the safe
 * update ordering for model (§5.5) and embedding (§5.6) switches
 * independently — including orphan file cleanup after a switch.
 */
export class ModelRegistry {
  async setCurrentModel(): Promise<never> {
    throw new Error('not implemented — see TZ §5.5-§5.6, ROADMAP Phase 1/2');
  }
}
