/**
 * Not implemented — Phase 4 (ROADMAP.md). Sits between `LocalAiClient` and
 * `LlmRuntimePort`: resolves chat-template formatting (native
 * `messages`-passthrough vs. the built-in preset registry keyed by
 * `ModelArtifact.chatTemplate`, TZ §4.1), enforces the single-generation
 * concurrency rule (`RuntimeBusyError`, TZ §9.4), and applies the context
 * window policy (TZ §9.7) before calling into the runtime port.
 */
export class RuntimeFacade {
  complete(): never {
    throw new Error('not implemented — see TZ §4.1, §9.4, §9.7, ROADMAP Phase 4');
  }
}
