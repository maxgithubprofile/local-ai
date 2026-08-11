import { describe, expect, it } from 'vitest';
import { buildContextWindow, estimateTokensHeuristic } from '../../../src/core/conversations/context-window-policy.js';
import { ContextWindowExceededError } from '../../../src/core/errors.js';

// Fixed 1-token-per-word estimator makes budgets easy to reason about in
// tests, instead of the chars/4 default heuristic.
const wordTokens = (text: string): number => text.split(/\s+/).filter(Boolean).length;

describe('estimateTokensHeuristic', () => {
  it('estimates roughly chars / 4', () => {
    expect(estimateTokensHeuristic('twelve chars')).toBe(3); // 12 chars -> ceil(12/4)
  });
});

describe('buildContextWindow', () => {
  it('keeps everything when it all fits', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'one two' },
      { role: 'assistant' as const, content: 'three four' },
    ];
    const result = buildContextWindow(messages, { maxContextTokens: 100, contextStrategy: 'truncate-oldest', estimateTokens: wordTokens });
    expect(result.messages).toEqual(messages);
    expect(result.droppedCount).toBe(0);
    expect(result.truncatedOldest).toBe(false);
  });

  it('always keeps the system message even under a very tight budget', () => {
    const messages = [
      { role: 'system' as const, content: 'one two three' },
      { role: 'user' as const, content: 'a b c d e f g h' },
    ];
    const result = buildContextWindow(messages, { maxContextTokens: 3, contextStrategy: 'truncate-oldest', estimateTokens: wordTokens });
    expect(result.messages).toEqual([{ role: 'system', content: 'one two three' }]);
    expect(result.droppedCount).toBe(1);
  });

  it("'truncate-oldest' drops the oldest non-system messages first, keeps the newest", () => {
    const messages = [
      { role: 'user' as const, content: 'a b' }, // 2 tokens, oldest
      { role: 'assistant' as const, content: 'c d' }, // 2 tokens
      { role: 'user' as const, content: 'e f' }, // 2 tokens, newest
    ];
    const result = buildContextWindow(messages, { maxContextTokens: 4, contextStrategy: 'truncate-oldest', estimateTokens: wordTokens });
    expect(result.messages).toEqual([
      { role: 'assistant', content: 'c d' },
      { role: 'user', content: 'e f' },
    ]);
    expect(result.droppedCount).toBe(1);
    expect(result.truncatedOldest).toBe(false);
  });

  it("'fail' throws ContextWindowExceededError instead of dropping anything", () => {
    const messages = [
      { role: 'user' as const, content: 'a b c' },
      { role: 'user' as const, content: 'd e f' },
    ];
    expect(() =>
      buildContextWindow(messages, { maxContextTokens: 3, contextStrategy: 'fail', estimateTokens: wordTokens }),
    ).toThrow(ContextWindowExceededError);
  });

  it("'truncate-to-fit' shortens the boundary message instead of dropping it whole", () => {
    const messages = [
      { role: 'user' as const, content: 'one two three four five six' }, // 6 tokens, oldest — will be the boundary
      { role: 'user' as const, content: 'seven eight' }, // 2 tokens, newest, fits fully
    ];
    // Budget: 2 (newest) + 3 (leftover for the boundary message) = 5.
    const result = buildContextWindow(messages, {
      maxContextTokens: 5,
      contextStrategy: 'truncate-to-fit',
      estimateTokens: wordTokens,
    });

    expect(result.truncatedOldest).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({ role: 'user', content: 'seven eight' });
    // The truncated message keeps only the tail, within the remaining budget.
    expect(wordTokens(result.messages[0]!.content)).toBeLessThanOrEqual(3);
    expect('one two three four five six'.endsWith(result.messages[0]!.content)).toBe(true);
  });

  it('uses a precomputed tokenCount over the estimator when present', () => {
    const messages = [{ role: 'user' as const, content: 'short text but a huge tokenCount', tokenCount: 1000 }];
    const result = buildContextWindow(messages, {
      maxContextTokens: 5,
      contextStrategy: 'truncate-oldest',
      estimateTokens: wordTokens, // would say ~6 tokens, but tokenCount (1000) should win and cause a drop
    });
    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(1);
  });

  it('never mutates chat_messages semantics — output is a fresh array, not the input', () => {
    const messages = [{ role: 'user' as const, content: 'a' }];
    const result = buildContextWindow(messages, { maxContextTokens: 100, contextStrategy: 'truncate-oldest' });
    expect(result.messages).not.toBe(messages);
  });
});
