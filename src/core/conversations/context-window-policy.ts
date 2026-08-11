import { ContextWindowExceededError } from '../errors.js';
import type { ContextStrategy } from '../types.js';

/** The subset of `ChatMessage` this pure function actually needs. */
export interface ContextWindowMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  tokenCount?: number;
}

export interface ContextWindowResult {
  /** Messages to actually send to the runtime, in chronological order — system message(s) first, then the kept window. */
  messages: ContextWindowMessage[];
  /** How many *whole* non-system messages were left out of `messages` entirely (dropped, not truncated). */
  droppedCount: number;
  /** True if the oldest kept message's `content` was shortened (`'truncate-to-fit'` only). */
  truncatedOldest: boolean;
}

/** TZ §9.7's fallback token estimate — used until a real `LlmRuntimePort.countTokens()` call is available for a message. */
export function estimateTokensHeuristic(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Default completion length assumed when `completionOptions.maxTokens` isn't given — TZ §9.7. */
export const DEFAULT_COMPLETION_MAX_TOKENS = 512;
/** Headroom subtracted on top of the reply budget, for template/special-token overhead — TZ §9.7. */
export const CONTEXT_SAFETY_MARGIN_TOKENS = 64;

/**
 * TZ §9.7's default `maxContextTokens`: `model.contextLength −
 * (completionOptions.maxTokens ?? default) − safety margin`. Clamped to at
 * least 1 so a pathologically small `contextLength` never produces a
 * negative/zero budget that would make every message un-fittable.
 */
export function defaultMaxContextTokens(modelContextLength: number, requestedMaxTokens?: number): number {
  const reserved = (requestedMaxTokens ?? DEFAULT_COMPLETION_MAX_TOKENS) + CONTEXT_SAFETY_MARGIN_TOKENS;
  return Math.max(1, modelContextLength - reserved);
}

/**
 * Fits `messages` into `maxContextTokens` per TZ §9.7's algorithm — a pure
 * function (no I/O, no model), unit-testable on its own. The system
 * message (if any) is always kept and counted but never dropped/truncated.
 * Non-system messages are walked newest-to-oldest, kept as long as they
 * fit; once one doesn't:
 *
 * - `'fail'` — throws `ContextWindowExceededError` (generation must not start).
 * - `'truncate-oldest'` (default) — that message and everything older is dropped whole.
 * - `'truncate-to-fit'` — like `'truncate-oldest'`, except the one message that first
 *   didn't fit gets its `content` shortened to the remaining budget instead of being
 *   dropped outright (only when there's at least 1 token of budget left for it).
 *
 * Truncation never touches `chat_messages` in SQL — this only decides what
 * goes into *this* prompt; `getMessages()` always returns the untouched
 * full history (TZ §9.7).
 */
export function buildContextWindow(
  messages: ContextWindowMessage[],
  options: {
    maxContextTokens: number;
    contextStrategy: ContextStrategy;
    estimateTokens?: (text: string) => number;
  },
): ContextWindowResult {
  const estimateTokens = options.estimateTokens ?? estimateTokensHeuristic;
  const tokensOf = (m: ContextWindowMessage): number => m.tokenCount ?? estimateTokens(m.content);

  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  let total = systemMessages.reduce((sum, m) => sum + tokensOf(m), 0);

  const kept: ContextWindowMessage[] = [];
  let truncatedOldest = false;

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const message = nonSystem[i]!;
    const cost = tokensOf(message);
    const remaining = options.maxContextTokens - total;

    if (cost <= remaining) {
      kept.unshift(message);
      total += cost;
      continue;
    }

    // This message (and, by construction, every older one) doesn't fit.
    if (options.contextStrategy === 'fail') {
      throw new ContextWindowExceededError(
        `chat history (${nonSystem.length} non-system messages) does not fit maxContextTokens=${options.maxContextTokens} with contextStrategy 'fail'`,
      );
    }

    if (options.contextStrategy === 'truncate-to-fit' && remaining > 0) {
      const shortened = truncateToApproxTokens(message.content, remaining, estimateTokens);
      if (shortened.length > 0) {
        kept.unshift({ role: message.role, content: shortened });
        total += estimateTokens(shortened);
        truncatedOldest = true;
      }
    }

    break;
  }

  return { messages: [...systemMessages, ...kept], droppedCount: nonSystem.length - kept.length, truncatedOldest };
}

/**
 * Shortens `content` to approximately `tokenBudget` tokens per
 * `estimateTokens`, keeping the *tail* (the end of an old message is
 * usually where it wraps up / is most recently relevant). Approximate by
 * construction — without real tokenizer offsets there's no way to cut on
 * an exact token boundary from a plain count function, only to converge on
 * one by shrinking until the estimate fits.
 */
function truncateToApproxTokens(content: string, tokenBudget: number, estimateTokens: (text: string) => number): string {
  if (tokenBudget <= 0) return '';
  if (estimateTokens(content) <= tokenBudget) return content;

  const ratio = tokenBudget / estimateTokens(content);
  let text = content.slice(content.length - Math.max(1, Math.floor(content.length * ratio)));
  while (text.length > 0 && estimateTokens(text) > tokenBudget) {
    text = text.slice(Math.ceil(text.length * 0.1));
  }
  return text;
}
