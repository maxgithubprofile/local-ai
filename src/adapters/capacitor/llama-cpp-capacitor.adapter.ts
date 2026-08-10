import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream } from '../../core/types.js';

/**
 * Not implemented — Phase 4 (ROADMAP.md). Wraps `llama-cpp-capacitor`
 * (`arusatech/llama-cpp`, TZ §4.1): `initLlama`/`completion`/`embedding`/
 * `release`/`stopCompletion`/`saveSession`/`loadSession`/`loadLlamaModelInfo`.
 * LoRA is present in the underlying plugin's API but deliberately unused
 * (TZ §1 non-goals) — `LlmRuntimePort` has no LoRA fields, so this adapter
 * simply never calls those methods. Real method names/signatures are
 * confirmed against the installed plugin version in the Phase 0 spike —
 * README claims are not trusted as-is (TZ §4.1).
 */
export class LlamaCppCapacitorAdapter implements LlmRuntimePort {
  async loadModel(_options: { modelPath: string; contextLength: number }): Promise<void> {
    throw new Error('not implemented — see TZ §4.1, ROADMAP Phase 4');
  }

  async loadEmbeddingModel(_options: { modelPath: string }): Promise<void> {
    throw new Error('not implemented — see TZ §4.1, ROADMAP Phase 4');
  }

  async releaseModel(): Promise<void> {
    throw new Error('not implemented — see TZ §5.5, ROADMAP Phase 4');
  }

  async releaseEmbeddingModel(): Promise<void> {
    throw new Error('not implemented — see TZ §5.6, ROADMAP Phase 4');
  }

  complete(_input: CompletionInput, _signal?: AbortSignal): CompletionStream<CompletionResult> {
    throw new Error('not implemented — see TZ §4.1, §10.0, ROADMAP Phase 4');
  }

  async embed(_text: string | string[]): Promise<Float32Array | Float32Array[]> {
    throw new Error('not implemented — see TZ §4.1, ROADMAP Phase 4');
  }

  async countTokens(_text: string): Promise<number> {
    throw new Error('not implemented — see TZ §9.7, §16.19, ROADMAP Phase 4');
  }

  async bench(): Promise<{ tgAvg: number }> {
    throw new Error('not implemented — see TZ §6.3, ROADMAP Phase 4');
  }

  async saveSession(_sessionPath: string): Promise<void> {
    throw new Error('not implemented — see TZ §9.3, ROADMAP Phase 4/5');
  }

  async loadSession(_sessionPath: string): Promise<void> {
    throw new Error('not implemented — see TZ §9.3, ROADMAP Phase 4/5');
  }
}
