import { describe, it, expect, vi, beforeEach } from 'vitest';

// `llama-cpp-pro`'s (formerly `llama-cpp-capacitor`, see
// docs/adr/0008-llama-cpp-pro-migration.md) `initLlama()` returns a
// `LlamaContext` instance whose `.completion()` this adapter calls directly
// — mocked here the same way capacitor-fs.adapter.test.ts mocks
// `@capacitor/filesystem`'s singleton, rather than going through a real
// native bridge.
const mockCompletion = vi.fn();

vi.mock('llama-cpp-pro', () => ({
  initLlama: vi.fn(async () => ({
    completion: (...args: unknown[]) => mockCompletion(...args),
    stopCompletion: vi.fn(async () => undefined),
  })),
}));

// vi.mock factories are hoisted above imports/local variables, so the mocked
// module is loaded dynamically after registering the mocks — matches
// capacitor-range-download.adapter.test.ts's own ordering in this repo.
const { LlamaCppCapacitorAdapter } = await import('../../../src/adapters/capacitor/llama-cpp-capacitor.adapter.js');

const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [{ role: 'user', content: 'привет' }];

beforeEach(() => {
  vi.clearAllMocks();
});

async function loadedAdapter(): Promise<InstanceType<typeof LlamaCppCapacitorAdapter>> {
  const adapter = new LlamaCppCapacitorAdapter();
  await adapter.loadModel({ modelPath: '/abs/model.gguf', contextLength: 4096 });
  return adapter;
}

describe('LlamaCppCapacitorAdapter.complete() — native-jinja failure fallback', () => {
  it('calls completion() with messages + jinja: true when not skipNativeTemplating, and returns its result on success', async () => {
    mockCompletion.mockResolvedValue({ content: 'hi there', interrupted: false, tokens_predicted: 3 });
    const adapter = await loadedAdapter();

    const stream = adapter.complete({ messages });
    const result = await stream.result;

    expect(result).toEqual({ content: 'hi there', status: 'complete', tokenCount: 3 });
    expect(mockCompletion).toHaveBeenCalledTimes(1);
    const params = mockCompletion.mock.calls[0]![0] as { jinja: boolean; messages?: unknown };
    expect(params.jinja).toBe(true);
    expect(params.messages).toEqual([{ role: 'user', content: 'привет' }]);
  });

  it('retries once with a ChatML-formatted prompt when the native-jinja attempt throws before any token streamed', async () => {
    mockCompletion
      .mockRejectedValueOnce(new Error("Cannot destructure property 'minja' of 'this.model.chatTemplates' as it is undefined."))
      .mockResolvedValueOnce({ content: 'ChatML reply', interrupted: false, tokens_predicted: 5 });
    const adapter = await loadedAdapter();

    const stream = adapter.complete({ messages });
    const result = await stream.result;

    expect(result).toEqual({ content: 'ChatML reply', status: 'complete', tokenCount: 5 });
    expect(mockCompletion).toHaveBeenCalledTimes(2);
    const firstParams = mockCompletion.mock.calls[0]![0] as { jinja: boolean };
    const retryParams = mockCompletion.mock.calls[1]![0] as { jinja: boolean; prompt: string };
    expect(firstParams.jinja).toBe(true);
    expect(retryParams.jinja).toBe(false);
    expect(retryParams.prompt).toContain('<|im_start|>user\nпривет<|im_end|>\n');
    // Ends with an already-closed, empty <think> block — the ChatML
    // fallback's own skip-thinking prefill (enable_thinking:false only
    // works through jinja, which is exactly what's unavailable here).
    expect(retryParams.prompt).toBe('<|im_start|>user\nпривет<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n');
  });

  it('does not retry, and surfaces errorMessage, when the second (ChatML) attempt also fails', async () => {
    mockCompletion.mockRejectedValue(new Error('native completion exploded'));
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(mockCompletion).toHaveBeenCalledTimes(2); // native-jinja attempt + one ChatML retry, no third attempt
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('native completion exploded');
  });

  it('does not retry when tokens already streamed before the native-jinja attempt failed', async () => {
    mockCompletion.mockImplementation(async (_params: unknown, onToken: (d: { token: string }) => void) => {
      onToken({ token: 'partial ' });
      throw new Error('failed mid-stream');
    });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(mockCompletion).toHaveBeenCalledTimes(1); // no retry — some output was already visible
    expect(result.status).toBe('error');
    expect(result.content).toBe('partial ');
    expect(result.errorMessage).toBe('failed mid-stream');
  });

  it('does not retry when the caller already used skipNativeTemplating (mechanism 2 has no further fallback)', async () => {
    mockCompletion.mockRejectedValue(new Error('mechanism 2 failed too'));
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }, undefined, { skipNativeTemplating: true }).result;

    expect(mockCompletion).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('mechanism 2 failed too');
  });

  it('does not retry, and resolves cancelled, when the native-jinja attempt throws after an abort', async () => {
    const controller = new AbortController();
    mockCompletion.mockImplementation(async () => {
      controller.abort();
      throw new Error('stopped by abort');
    });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }, controller.signal).result;

    expect(mockCompletion).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('cancelled');
  });
});

describe('LlamaCppCapacitorAdapter.complete() — reasoning-content splitting', () => {
  it("prefers native.reasoning_content when the plugin's own template pipeline populated it", async () => {
    mockCompletion.mockResolvedValue({
      content: 'Привет!',
      reasoning_content: 'thinking about it',
      interrupted: false,
      tokens_predicted: 4,
    });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(result.content).toBe('Привет!');
    expect(result.reasoningContent).toBe('thinking about it');
  });

  it('falls back to extracting a raw <think> block from content when reasoning_content is empty (the ChatML-fallback path)', async () => {
    mockCompletion.mockResolvedValue({
      content: '<think>\nOkay, thinking...\n</think>\n\nПривет!',
      reasoning_content: '',
      interrupted: false,
      tokens_predicted: 10,
    });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(result.content).toBe('Привет!');
    expect(result.reasoningContent).toBe('Okay, thinking...');
  });

  it('leaves reasoningContent undefined, and content untouched, when there is no <think> block at all', async () => {
    mockCompletion.mockResolvedValue({ content: 'Привет!', interrupted: false, tokens_predicted: 2 });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(result.content).toBe('Привет!');
    expect(result.reasoningContent).toBeUndefined();
  });
});

describe('LlamaCppCapacitorAdapter.complete() — ran out of budget while still reasoning', () => {
  it("surfaces status: 'error' when generation resolves 'complete' but the answer (post-<think>-split) is empty", async () => {
    mockCompletion.mockResolvedValue({
      content: '<think>\nOkay, let me think about this some more...\n', // never closed — cut off mid-reasoning
      interrupted: false,
      tokens_predicted: 512,
    });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(result.status).toBe('error');
    expect(result.errorMessage).toMatch(/ran out of its token budget/i);
    // the raw reasoning is preserved in content (not silently discarded) so it's at least inspectable/loggable
    expect(result.content).toContain('Okay, let me think about this some more');
  });

  it('does not misfire when the answer is genuinely empty on a cancellation', async () => {
    mockCompletion.mockResolvedValue({ content: '', interrupted: true, tokens_predicted: 0 });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(result.status).toBe('cancelled'); // not reclassified as an error
  });

  it('leaves a genuine short answer alone (does not misfire on normal short replies)', async () => {
    mockCompletion.mockResolvedValue({ content: 'Привет!', interrupted: false, tokens_predicted: 3 });
    const adapter = await loadedAdapter();

    const result = await adapter.complete({ messages }).result;

    expect(result.status).toBe('complete');
    expect(result.content).toBe('Привет!');
  });
});
