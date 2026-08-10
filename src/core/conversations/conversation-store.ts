import type { SqlitePort, SqliteRow } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { Chat, ChatMessage } from './conversation.types.js';

interface ChatRow extends SqliteRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

interface ChatMessageRow extends SqliteRow {
  chat_id: string;
  id: string;
  role: ChatMessage['role'];
  content: string;
  status: ChatMessage['status'];
  created_at: string;
  token_count: number | null;
  metadata: string | null;
}

function rowToChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
  };
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
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

/**
 * SQL-backed implementation of `chats`/`chat_messages` (TZ §8.1, §9.1-§9.2)
 * via `SqlitePort` — MVP `ConversationApi` (Mode A) only.
 * `ConversationSyncApi` (`upsertChat`/`appendMessages`, Mode B) is added in
 * Phase 5 per `ROADMAP.md`, once idempotency semantics are exercised
 * alongside the rest of that phase's cancel/error/switch-flow work.
 */
export class ConversationStore {
  constructor(
    private readonly sqlite: SqlitePort,
    private readonly clock: ClockPort,
  ) {}

  async createChat(options?: {
    id?: string;
    title?: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    const id = options?.id ?? globalThis.crypto.randomUUID();
    const title = options?.title ?? 'New chat';
    const now = this.clock.nowIso();
    const metadataJson = options?.metadata ? JSON.stringify(options.metadata) : null;

    await this.sqlite.transaction(async (tx) => {
      await tx.execute('INSERT INTO chats (id, title, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)', [
        id,
        title,
        now,
        now,
        metadataJson,
      ]);
      if (options?.systemPrompt) {
        await tx.execute(
          'INSERT INTO chat_messages (chat_id, id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, globalThis.crypto.randomUUID(), 'system', options.systemPrompt, 'complete', now],
        );
      }
    });

    return { id, title, createdAt: now, updatedAt: now, metadata: options?.metadata };
  }

  async listChats(options?: { limit?: number; offset?: number; orderBy?: 'updatedAt' | 'createdAt' }): Promise<Chat[]> {
    const orderColumn = options?.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
    const rows = await this.sqlite.query<ChatRow>(
      `SELECT * FROM chats ORDER BY ${orderColumn} DESC LIMIT ? OFFSET ?`,
      [options?.limit ?? 200, options?.offset ?? 0],
    );
    return rows.map(rowToChat);
  }

  async getChat(chatId: string): Promise<Chat | null> {
    const rows = await this.sqlite.query<ChatRow>('SELECT * FROM chats WHERE id = ?', [chatId]);
    return rows[0] ? rowToChat(rows[0]) : null;
  }

  async renameChat(chatId: string, title: string): Promise<void> {
    await this.sqlite.execute('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?', [
      title,
      this.clock.nowIso(),
      chatId,
    ]);
  }

  /**
   * Cascades to `chat_messages` explicitly (not relying on the schema's
   * `ON DELETE CASCADE`, since `PRAGMA foreign_keys` defaults to off per
   * connection on SQLite and isn't guaranteed enabled by every adapter) —
   * both deletes run in one transaction. Session-cache file cleanup (the
   * other half of TZ §9.2's "cascades to messages and the chat's
   * session-cache file") is `LocalAiClient`'s job once `SessionCache`
   * exists (Phase 5) — this class only owns the SQL side.
   */
  async deleteChat(chatId: string): Promise<void> {
    await this.sqlite.transaction(async (tx) => {
      await tx.execute('DELETE FROM chat_messages WHERE chat_id = ?', [chatId]);
      await tx.execute('DELETE FROM chats WHERE id = ?', [chatId]);
    });
  }

  async getMessages(chatId: string, options?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    let sql = 'SELECT * FROM chat_messages WHERE chat_id = ?';
    const params: unknown[] = [chatId];
    if (options?.before) {
      sql += ' AND created_at < ?';
      params.push(options.before);
    }
    sql += ' ORDER BY created_at ASC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = await this.sqlite.query<ChatMessageRow>(sql, params);
    return rows.map(rowToMessage);
  }
}
