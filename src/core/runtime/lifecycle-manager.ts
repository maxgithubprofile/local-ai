/**
 * Not implemented — Phase 6 (ROADMAP.md). Implements `releaseRuntime()`
 * (TZ §11.1: releases LLM/embedding contexts, optionally closes the DB,
 * resets in-memory caches — never touches on-disk files, chats, or
 * `download_state`) and the optional `autoUnloadOnBackground` wiring over
 * `AppLifecyclePort` (TZ §11.2). Must be idempotent.
 */
export class LifecycleManager {
  async releaseRuntime(): Promise<never> {
    throw new Error('not implemented — see TZ §11, ROADMAP Phase 6');
  }
}
