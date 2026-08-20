import { describe, it, expect } from 'vitest';
import { splitReasoningContent } from '../../../src/core/runtime/reasoning-content.js';

describe('splitReasoningContent()', () => {
  it('splits a closed <think> block from the answer, trimming both', () => {
    const result = splitReasoningContent('<think>\nOkay, the user said hi.\n</think>\n\nПривет!');

    expect(result.reasoningContent).toBe('Okay, the user said hi.');
    expect(result.content).toBe('Привет!');
  });

  it('returns reasoningContent: null and the trimmed text unchanged when there is no <think> tag at all', () => {
    const result = splitReasoningContent('  Привет!  ');

    expect(result.reasoningContent).toBeNull();
    expect(result.content).toBe('Привет!');
  });

  it('returns reasoningContent: null for an empty <think></think> block, dropping just the tags', () => {
    const result = splitReasoningContent('<think>\n</think>\n\nПривет! Твой тест похож на случайное число.');

    expect(result.reasoningContent).toBeNull();
    expect(result.content).toBe('Привет! Твой тест похож на случайное число.');
  });

  it('joins text that appears before and after the block', () => {
    const result = splitReasoningContent('lead-in <think>reasoning here</think> trailing text');

    expect(result.reasoningContent).toBe('reasoning here');
    expect(result.content).toBe('lead-in  trailing text');
  });

  it('treats an unclosed <think> tag as pure reasoning with empty content — generation was cut off before ever answering', () => {
    const result = splitReasoningContent('<think>\nstill reasoning, no closing tag yet');

    expect(result.reasoningContent).toBe('still reasoning, no closing tag yet');
    expect(result.content).toBe('');
  });

  it('preserves text before an unclosed <think> tag as content, even with no answer after it', () => {
    const result = splitReasoningContent('lead-in <think>never finished');

    expect(result.reasoningContent).toBe('never finished');
    expect(result.content).toBe('lead-in');
  });

  it('reports reasoningContent: null for an unclosed <think> tag with nothing after it', () => {
    const result = splitReasoningContent('<think>');

    expect(result.reasoningContent).toBeNull();
    expect(result.content).toBe('');
  });

  it('only splits the first <think> block when multiple are present', () => {
    const result = splitReasoningContent('<think>first</think>middle<think>second</think>end');

    expect(result.reasoningContent).toBe('first');
    expect(result.content).toBe('middle<think>second</think>end');
  });
});
