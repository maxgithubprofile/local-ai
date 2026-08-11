import type { SqliteRow } from '../ports/sqlite.port.js';
import type { ChatMessage } from './conversation.types.js';

/** Raw `chat_messages` row shape, `snake_case` per TZ §8.1 — shared by `ConversationStore` and the Phase 8 search index classes so both map rows identically. */
export interface ChatMessageRow extends SqliteRow {
  chat_id: string;
  id: string;
  role: ChatMessage['role'];
  content: string;
  status: ChatMessage['status'];
  created_at: string;
  token_count: number | null;
  metadata: string | null;
}

/** `chat_messages` row -> public `ChatMessage` — single source of truth for this mapping. */
export function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    tokenCount: row.token_count ?? undefined,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
  };
}
