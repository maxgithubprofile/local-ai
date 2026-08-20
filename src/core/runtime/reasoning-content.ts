/**
 * Reasoning models (Qwen3 and others) wrap their internal chain-of-thought
 * in `<think>...</think>` before the real answer. `llama-cpp-pro`'s (formerly
 * `llama-cpp-capacitor`) own `reasoning_content`/`content` split (`NativeCompletionResult`) only
 * fires when the plugin applies the GGUF's native chat template — the
 * `LlamaCppCapacitorAdapter` ChatML fallback (see its own doc comment) has
 * to build the raw prompt itself, so the plugin has no template pipeline to
 * parse the reply through, and the tags land in `content` completely raw.
 * This is the adapter-agnostic net: whatever produced `content`, if it
 * still contains a `<think>` block, split it out before it's shown or
 * persisted as chat history — live bug, 2026-08-19, confirmed on-device:
 * without this, the literal `<think>...</think>` text both rendered in the
 * UI and got replayed back to the model as if it were normal dialogue on
 * every later turn (wasting context-window budget on the model's own
 * internal monologue).
 */
export interface SplitReasoningResult {
  /** The answer, with any `<think>...</think>` block removed and surrounding whitespace trimmed. Empty when generation was cut off before ever producing one — see the unclosed-tag case below. */
  content: string;
  /** The reasoning text (tags stripped), or `null` if there was no `<think>` block, or it was empty. */
  reasoningContent: string | null;
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Extracts a `<think>...</think>` block from `text`. Text before/after a
 * *closed* block is preserved (joined) as `content`. Both of this
 * function's callers (`LlamaCppCapacitorAdapter`, `NodeLlamaCppAdapter`)
 * only ever call it on a *settled, final* completion result — never on a
 * still-streaming buffer — so an unclosed `<think>` unambiguously means
 * generation was cut off before ever reaching an answer (confirmed live,
 * 2026-08-20: the token budget can run out mid-reasoning). Everything from
 * the tag onward is reported as `reasoningContent` in that case, `content`
 * stays whatever preceded the tag (typically empty) — callers use an empty
 * `content` here as the signal to surface this as a failure rather than a
 * genuine (if terse) answer. Streaming-in-progress text has its own,
 * separate handling — forta.chat's `parseThinking()` — since *that* context
 * needs the opposite read of an unclosed tag ("still thinking, not done
 * yet") rather than this one's ("never finished at all").
 */
export function splitReasoningContent(text: string): SplitReasoningResult {
  const openIdx = text.indexOf(THINK_OPEN);
  if (openIdx === -1) return { content: text.trim(), reasoningContent: null };

  const before = text.slice(0, openIdx);
  const closeIdx = text.indexOf(THINK_CLOSE, openIdx + THINK_OPEN.length);

  if (closeIdx === -1) {
    const reasoning = text.slice(openIdx + THINK_OPEN.length).trim();
    return { content: before.trim(), reasoningContent: reasoning.length > 0 ? reasoning : null };
  }

  const reasoning = text.slice(openIdx + THINK_OPEN.length, closeIdx).trim();
  const after = text.slice(closeIdx + THINK_CLOSE.length);
  return { content: (before + after).trim(), reasoningContent: reasoning.length > 0 ? reasoning : null };
}
