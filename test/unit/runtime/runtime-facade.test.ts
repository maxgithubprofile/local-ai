import { describe, expect, it } from 'vitest';
import { RuntimeFacade } from '../../../src/core/runtime/runtime-facade.js';
import { FakeLlmRuntimeAdapter } from '../../../src/adapters/node-testing/fake-llm-runtime.adapter.js';
import { RuntimeBusyError } from '../../../src/core/errors.js';

describe('RuntimeFacade', () => {
  it("mechanism 1 ('auto'): passes messages through unchanged, skipNativeTemplating false", async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const facade = new RuntimeFacade(runtime);

    const input = { messages: [{ role: 'user' as const, content: 'hi' }] };
    const stream = facade.complete(input, { chatTemplate: 'auto' });
    await stream.result;

    expect(runtime.completeCalls).toHaveLength(1);
    expect(runtime.completeCalls[0]?.input).toBe(input);
    expect(runtime.completeCalls[0]?.options?.skipNativeTemplating).toBeFalsy();
  });

  it("mechanism 2 (explicit preset): formats messages into one string, skipNativeTemplating true", async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const facade = new RuntimeFacade(runtime);

    const input = {
      messages: [
        { role: 'system' as const, content: 'sys' },
        { role: 'user' as const, content: 'hi' },
      ],
    };
    const stream = facade.complete(input, { chatTemplate: 'qwen' });
    await stream.result;

    const call = runtime.completeCalls[0]!;
    expect(call.options?.skipNativeTemplating).toBe(true);
    expect(call.input.messages).toHaveLength(1);
    expect(call.input.messages[0]?.content).toContain('<|im_start|>system\nsys<|im_end|>');
    expect(call.input.messages[0]?.content).toContain('<|im_start|>user\nhi<|im_end|>');
  });

  it('streams tokens through to the caller and resolves the same result', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    runtime.scriptedTokens = ['a', 'b', 'c'];
    const facade = new RuntimeFacade(runtime);

    const stream = facade.complete({ messages: [{ role: 'user', content: 'hi' }] }, { chatTemplate: 'auto' });
    const tokens: string[] = [];
    for await (const t of stream) tokens.push(t.token);
    const result = await stream.result;

    expect(tokens).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ content: 'abc', status: 'complete', tokenCount: 3 });
  });

  it('a second concurrent complete() call rejects with RuntimeBusyError, first is unaffected', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    runtime.scriptedOutcome = 'hang';
    const facade = new RuntimeFacade(runtime);
    const firstController = new AbortController();

    const first = facade.complete(
      { messages: [{ role: 'user', content: 'first' }] },
      { chatTemplate: 'auto' },
      firstController.signal,
    );
    expect(facade.isBusy).toBe(true);

    const second = facade.complete({ messages: [{ role: 'user', content: 'second' }] }, { chatTemplate: 'auto' });
    await expect(second.result).rejects.toThrow(RuntimeBusyError);

    const secondTokens: unknown[] = [];
    for await (const t of second) secondTokens.push(t);
    expect(secondTokens).toEqual([]);
    expect(runtime.completeCalls).toHaveLength(1); // second call never reached the runtime port at all

    firstController.abort(); // let the hung first call settle so it doesn't leak into the next test
    await first.result;
  });

  it('isBusy becomes false again once the in-flight generation settles', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const facade = new RuntimeFacade(runtime);

    const stream = facade.complete({ messages: [{ role: 'user', content: 'hi' }] }, { chatTemplate: 'auto' });
    expect(facade.isBusy).toBe(true);
    await stream.result;
    expect(facade.isBusy).toBe(false);

    // A new call after settling succeeds normally (not busy).
    const next = facade.complete({ messages: [{ role: 'user', content: 'again' }] }, { chatTemplate: 'auto' });
    await expect(next.result).resolves.toMatchObject({ status: 'complete' });
  });

  it('isBusy becomes false again after an aborted generation settles as cancelled', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const facade = new RuntimeFacade(runtime);
    const controller = new AbortController();

    const stream = facade.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { chatTemplate: 'auto' },
      controller.signal,
    );
    controller.abort();
    const result = await stream.result;

    expect(result.status).toBe('cancelled');
    expect(facade.isBusy).toBe(false);
  });
});
