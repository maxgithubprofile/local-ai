/**
 * Not implemented — Phase 5 (ROADMAP.md). Orchestrates `LlmRuntimePort`'s
 * `saveSession`/`loadSession` so switching between chats doesn't require
 * replaying the full history as a prompt every time — TZ §9.3. v1 caches
 * exactly one "hot" (most recently active) chat's session file; a
 * multi-slot LRU is explicitly deferred to Phase 8 (TZ §9.3, §16.8).
 * Session files are derived state: on missing/corrupt/incompatible-version,
 * this rebuilds from SQL history rather than failing.
 */
export class SessionCache {
  async loadOrRebuild(): Promise<never> {
    throw new Error('not implemented — see TZ §9.3, ROADMAP Phase 5');
  }
}
