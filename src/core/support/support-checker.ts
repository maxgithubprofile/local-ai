/**
 * Not implemented — Phase 1 (ROADMAP.md). Builds a {@link SupportReport}
 * from `PlatformSupportPort` per the degradation rule in TZ §6.1:
 * `inference` requires both a native platform and the LLM plugin being
 * available; `sql`/`download` may stay `true` on web if their own plugins
 * claim web support; missing `deviceInfo` doesn't block anything else, it
 * only disables eligibility checks. The exact per-plugin registration name
 * constants (`'CapacitorSQLite'` etc.) are confirmed by the Phase 0 spike,
 * not hardcoded ahead of it.
 */
export class SupportChecker {
  async check(): Promise<never> {
    throw new Error('not implemented — see TZ §6.1, ROADMAP Phase 1');
  }
}
