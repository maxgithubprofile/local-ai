/**
 * Not implemented — Phase 1 (ROADMAP.md). Owns fetching (`If-None-Match`
 * against the cached `ETag`, TZ §5.3), schema + consistency validation
 * (TZ §5.2: pinned revision, https embedding URL, hash format, size > 0,
 * `minRamGb`/`recommendedRamGb` bounds, `compatibleModelIds` includes the
 * current model), and producing a {@link ManifestDiff} via
 * `manifest.diff.ts`. On validation failure: keep serving the cached
 * manifest and emit `manifest:invalid` (TZ §5.2) instead of throwing past
 * the caller — the class method itself may still reject; the *event*
 * contract is what `LocalAiClient` relies on.
 */
export class ManifestService {
  async refresh(): Promise<never> {
    throw new Error('not implemented — see TZ §5.3-§5.4, ROADMAP Phase 1');
  }
}
