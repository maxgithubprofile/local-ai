import type { LlmRuntimePort } from '../../core/ports/llm-runtime.port.js';
import type { CompletionInput, CompletionResult, CompletionStream } from '../../core/types.js';

/**
 * Not implemented — Phase 4 (ROADMAP.md). `node-llama-cpp` (`withcatai/node-llama-cpp`)
 * as an alternative `LlmRuntimePort` for real GGUF inference in Node tests
 * — TZ §13.1. This is a real inference path (unlike the fakes above), but
 * it is explicitly NOT the production runtime — it never touches the
 * actual Capacitor native bridge. Add `node-llama-cpp` to devDependencies
 * when implemented; use small (0.1-0.5B) fixture GGUFs, TZ §13.4.
 */
export class NodeLlamaCppAdapter implements LlmRuntimePort {
  async loadModel(_options: { modelPath: string; contextLength: number }): Promise<void> {
    throw new Error('not implemented — see TZ §13.1, ROADMAP Phase 4');
  }

  async loadEmbeddingModel(_options: { modelPath: string }): Promise<void> {
    throw new Error('not implemented — see TZ §13.1, ROADMAP Phase 4');
  }

  async releaseModel(): Promise<void> {
    throw new Error('not implemented — see TZ §13.1, ROADMAP Phase 4');
  }

  async releaseEmbeddingModel(): Promise<void> {
    throw new Error('not implemented — see TZ §13.1, ROADMAP Phase 4');
  }

  complete(_input: CompletionInput, _signal?: AbortSignal): CompletionStream<CompletionResult> {
    throw new Error('not implemented — see TZ §13.1, ROADMAP Phase 4');
  }

  async embed(_text: string | string[]): Promise<Float32Array | Float32Array[]> {
    throw new Error('not implemented — see TZ §13.1, ROADMAP Phase 4');
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
