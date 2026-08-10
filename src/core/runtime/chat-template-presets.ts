/** One structured message, matching `CompletionInput.messages`'s element type. */
export interface ChatPresetMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Matches `ModelArtifact.chatTemplate`'s non-`'auto'` values — TZ §5.2/§4.1 mechanism 2. */
export type ChatTemplatePreset = 'qwen' | 'llama3' | 'gemma' | 'mistral' | 'raw';

/**
 * TZ §4.1 mechanism 2's "small embedded registry of templates" —
 * `RuntimeFacade` calls this to build a single formatted prompt string when
 * `ModelArtifact.chatTemplate` names an explicit preset (i.e. the GGUF's
 * own `tokenizer.chat_template` isn't trusted/available, so mechanism 1's
 * native template application is skipped). Pure function, no I/O — each
 * preset mirrors that model family's publicly documented special-token
 * chat format. Always ends with the assistant turn's opening tag/prefix
 * (no closing tag), so the model continues generation from there.
 */
export function formatChatPrompt(messages: ChatPresetMessage[], preset: ChatTemplatePreset): string {
  switch (preset) {
    case 'qwen':
      return formatChatml(messages);
    case 'llama3':
      return formatLlama3(messages);
    case 'gemma':
      return formatGemma(messages);
    case 'mistral':
      return formatMistral(messages);
    case 'raw':
      return formatRaw(messages);
  }
}

/** Qwen family — ChatML (`<|im_start|>role\n...content...<|im_end|>\n`), shared with several other model families too. */
function formatChatml(messages: ChatPresetMessage[]): string {
  let out = '';
  for (const m of messages) {
    out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  out += '<|im_start|>assistant\n';
  return out;
}

/** Llama 3 (Instruct) — `<|start_header_id|>role<|end_header_id|>\n\ncontent<|eot_id|>`. */
function formatLlama3(messages: ChatPresetMessage[]): string {
  let out = '<|begin_of_text|>';
  for (const m of messages) {
    out += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
  }
  out += '<|start_header_id|>assistant<|end_header_id|>\n\n';
  return out;
}

/**
 * Gemma (Instruct) — `<start_of_turn>user|model\n...content...<end_of_turn>\n`.
 * Gemma's template has no distinct `system` role — a leading system
 * message is folded into the first user turn (a blank line separates
 * them), matching the common community convention for Gemma system
 * prompts (the official template silently drops system messages
 * otherwise, which would lose the caller's intent).
 */
function formatGemma(messages: ChatPresetMessage[]): string {
  const merged: ChatPresetMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.role === 'system' && messages[i + 1]?.role === 'user') {
      merged.push({ role: 'user', content: `${m.content}\n\n${messages[i + 1]!.content}` });
      i += 2;
      continue;
    }
    merged.push(m.role === 'system' ? { role: 'user', content: m.content } : m);
    i += 1;
  }

  let out = '';
  for (const m of merged) {
    const gemmaRole = m.role === 'assistant' ? 'model' : 'user';
    out += `<start_of_turn>${gemmaRole}\n${m.content}<end_of_turn>\n`;
  }
  out += '<start_of_turn>model\n';
  return out;
}

/**
 * Mistral (Instruct) — `[INST] content [/INST] response</s>`. Like Gemma,
 * no dedicated system role in the classic template — folded into the first
 * `[INST]` block ahead of the user's own text.
 */
function formatMistral(messages: ChatPresetMessage[]): string {
  let out = '<s>';
  let pendingSystem: string | null = null;
  for (const m of messages) {
    if (m.role === 'system') {
      pendingSystem = m.content;
      continue;
    }
    if (m.role === 'user') {
      const prefix = pendingSystem ? `${pendingSystem}\n\n` : '';
      pendingSystem = null;
      out += `[INST] ${prefix}${m.content} [/INST]`;
    } else {
      out += ` ${m.content}</s>`;
    }
  }
  return out;
}

/** Model-agnostic fallback — no special tokens, just labeled turns. Used when a model's family isn't one of the above presets. */
function formatRaw(messages: ChatPresetMessage[]): string {
  const turns = messages.map((m) => `${m.role}: ${m.content}`);
  turns.push('assistant:');
  return turns.join('\n\n');
}
