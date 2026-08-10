import { describe, expect, it } from 'vitest';
import { formatChatPrompt } from '../../../src/core/runtime/chat-template-presets.js';

const messages = [
  { role: 'system' as const, content: 'You are a pirate.' },
  { role: 'user' as const, content: 'Hello!' },
  { role: 'assistant' as const, content: 'Ahoy!' },
  { role: 'user' as const, content: 'How are you?' },
];

describe('formatChatPrompt', () => {
  it('qwen preset produces ChatML with a trailing open assistant turn', () => {
    expect(formatChatPrompt(messages, 'qwen')).toBe(
      '<|im_start|>system\nYou are a pirate.<|im_end|>\n' +
        '<|im_start|>user\nHello!<|im_end|>\n' +
        '<|im_start|>assistant\nAhoy!<|im_end|>\n' +
        '<|im_start|>user\nHow are you?<|im_end|>\n' +
        '<|im_start|>assistant\n',
    );
  });

  it('llama3 preset produces header-tagged turns with a trailing open assistant header', () => {
    expect(formatChatPrompt(messages, 'llama3')).toBe(
      '<|begin_of_text|>' +
        '<|start_header_id|>system<|end_header_id|>\n\nYou are a pirate.<|eot_id|>' +
        '<|start_header_id|>user<|end_header_id|>\n\nHello!<|eot_id|>' +
        '<|start_header_id|>assistant<|end_header_id|>\n\nAhoy!<|eot_id|>' +
        '<|start_header_id|>user<|end_header_id|>\n\nHow are you?<|eot_id|>' +
        '<|start_header_id|>assistant<|end_header_id|>\n\n',
    );
  });

  it('gemma preset folds a leading system message into the following user turn', () => {
    expect(formatChatPrompt(messages, 'gemma')).toBe(
      '<start_of_turn>user\nYou are a pirate.\n\nHello!<end_of_turn>\n' +
        '<start_of_turn>model\nAhoy!<end_of_turn>\n' +
        '<start_of_turn>user\nHow are you?<end_of_turn>\n' +
        '<start_of_turn>model\n',
    );
  });

  it('gemma preset with no system message leaves user turns untouched', () => {
    const noSystem = messages.slice(1);
    expect(formatChatPrompt(noSystem, 'gemma')).toBe(
      '<start_of_turn>user\nHello!<end_of_turn>\n' +
        '<start_of_turn>model\nAhoy!<end_of_turn>\n' +
        '<start_of_turn>user\nHow are you?<end_of_turn>\n' +
        '<start_of_turn>model\n',
    );
  });

  it('mistral preset folds the system message into the first [INST] block', () => {
    expect(formatChatPrompt(messages, 'mistral')).toBe(
      '<s>[INST] You are a pirate.\n\nHello! [/INST] Ahoy!</s>[INST] How are you? [/INST]',
    );
  });

  it('raw preset labels each turn with its role and ends with an open assistant label', () => {
    expect(formatChatPrompt(messages, 'raw')).toBe(
      'system: You are a pirate.\n\n' +
        'user: Hello!\n\n' +
        'assistant: Ahoy!\n\n' +
        'user: How are you?\n\n' +
        'assistant:',
    );
  });

  it('every preset is deterministic — same input, same output', () => {
    for (const preset of ['qwen', 'llama3', 'gemma', 'mistral', 'raw'] as const) {
      expect(formatChatPrompt(messages, preset)).toBe(formatChatPrompt(messages, preset));
    }
  });
});
