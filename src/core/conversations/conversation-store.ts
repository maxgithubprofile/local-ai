import type { SqlitePort, SqliteRow } from '../ports/sqlite.port.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { Chat, ChatExport, ChatMessage } from './conversation.types.js';
import { MessageNotFoundError } from '../errors.js';
import { type ChatMessageRow, rowToMessage } from './chat-message-row.js';

interface ChatRow extends SqliteRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
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

/**
 * SQL-backed implementation of `chats`/`chat_messages` (TZ §8.1, §9.1-§9.2)
 * via `SqlitePort` — both the MVP `ConversationApi` (Mode A) and
 * `ConversationSyncApi` (`upsertChat`/`appendMessages`, Mode B, TZ §9.6).
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

  /**
   * Idempotent single-message insert — dedups by `(chatId, id)` via
   * `ON CONFLICT ... DO NOTHING`, reports whether it actually inserted
   * (`RETURNING id` on the insert statement itself, rather than a
   * separate existence check, keeps this a single round-trip). Used by
   * both `LocalAiClient.sendMessage()` (Phase 5) and {@link appendMessages}
   * below — content is immutable after first write (TZ §9.5), so a
   * "skip, don't overwrite" conflict policy is correct for both callers.
   */
  async addMessage(
    chatId: string,
    message: {
      id: string;
      role: ChatMessage['role'];
      content: string;
      status?: ChatMessage['status'];
      createdAt: string;
      tokenCount?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ inserted: boolean }> {
    const metadataJson = message.metadata ? JSON.stringify(message.metadata) : null;
    const rows = await this.sqlite.query<{ id: string }>(
      `INSERT INTO chat_messages (chat_id, id, role, content, status, created_at, token_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, id) DO NOTHING
       RETURNING id`,
      [
        chatId,
        message.id,
        message.role,
        message.content,
        message.status ?? 'complete',
        message.createdAt,
        message.tokenCount ?? null,
        metadataJson,
      ],
    );
    const inserted = rows.length > 0;
    if (inserted) {
      await this.sqlite.execute('UPDATE chats SET updated_at = ? WHERE id = ?', [message.createdAt, chatId]);
    }
    return { inserted };
  }

  /**
   * TZ §9.2/§9.6 Mode B — idempotent upsert by id: creates the chat if
   * missing; if it already exists, only `title`/`metadata`/`updatedAt` are
   * touched (messages are a completely separate table, untouched here
   * regardless). `metadata: undefined` on an update means "don't touch
   * it" (partial update), not "clear it" — a caller has to pass `{}`
   * explicitly to clear metadata.
   */
  async upsertChat(chat: {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Chat> {
    const existing = await this.getChat(chat.id);
    const now = this.clock.nowIso();

    if (!existing) {
      const createdAt = chat.createdAt ?? now;
      const updatedAt = chat.updatedAt ?? createdAt;
      await this.sqlite.execute('INSERT INTO chats (id, title, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)', [
        chat.id,
        chat.title,
        createdAt,
        updatedAt,
        chat.metadata ? JSON.stringify(chat.metadata) : null,
      ]);
      return { id: chat.id, title: chat.title, createdAt, updatedAt, metadata: chat.metadata };
    }

    const updatedAt = chat.updatedAt ?? now;
    if (chat.metadata !== undefined) {
      await this.sqlite.execute('UPDATE chats SET title = ?, metadata = ?, updated_at = ? WHERE id = ?', [
        chat.title,
        JSON.stringify(chat.metadata),
        updatedAt,
        chat.id,
      ]);
    } else {
      await this.sqlite.execute('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?', [chat.title, updatedAt, chat.id]);
    }
    return { id: chat.id, title: chat.title, createdAt: existing.createdAt, updatedAt, metadata: chat.metadata ?? existing.metadata };
  }

  /**
   * TZ §9.2/§9.6 Mode B — idempotent append: dedups by `(chatId, id)`
   * (via {@link addMessage}), silently skipping messages that already
   * exist rather than overwriting. Implicitly creates the chat (minimal
   * `upsertChat`) if `chatId` doesn't exist yet — a consumer syncing
   * history shouldn't have to call `upsertChat()` first just to append.
   */
  async appendMessages(
    chatId: string,
    messages: Array<{
      id: string;
      role: ChatMessage['role'];
      content: string;
      status?: ChatMessage['status'];
      createdAt: string;
      tokenCount?: number;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<{ inserted: number; skippedExisting: number }> {
    if (!(await this.getChat(chatId))) {
      await this.upsertChat({ id: chatId, title: 'New chat' });
    }

    let inserted = 0;
    let skippedExisting = 0;
    for (const message of messages) {
      const { inserted: wasInserted } = await this.addMessage(chatId, message);
      if (wasInserted) inserted += 1;
      else skippedExisting += 1;
    }
    return { inserted, skippedExisting };
  }

  /**
   * Phase 8, `docs/decisions.md` #7a — partial update of an already-stored
   * message; only fields present in `updates` are changed. Throws
   * {@link MessageNotFoundError} if `(chatId, messageId)` doesn't exist.
   * Session-cache invalidation is the caller's job (`LocalAiClient`, which
   * owns `SessionCache`) — this class only owns the SQL side, same
   * division as `deleteChat()`.
   */
  async updateMessage(
    chatId: string,
    messageId: string,
    updates: { content?: string; status?: ChatMessage['status']; tokenCount?: number; metadata?: Record<string, unknown> },
  ): Promise<ChatMessage> {
    const rows = await this.sqlite.query<ChatMessageRow>('SELECT * FROM chat_messages WHERE chat_id = ? AND id = ?', [
      chatId,
      messageId,
    ]);
    const existing = rows[0];
    if (!existing) {
      throw new MessageNotFoundError(`no message '${messageId}' in chat '${chatId}'`);
    }

    const content = updates.content ?? existing.content;
    const status = updates.status ?? existing.status;
    const tokenCount = updates.tokenCount ?? existing.token_count ?? undefined;
    const metadata = updates.metadata !== undefined ? updates.metadata : (existing.metadata ? (JSON.parse(existing.metadata) as Record<string, unknown>) : undefined);

    await this.sqlite.execute(
      'UPDATE chat_messages SET content = ?, status = ?, token_count = ?, metadata = ? WHERE chat_id = ? AND id = ?',
      [content, status, tokenCount ?? null, metadata ? JSON.stringify(metadata) : null, chatId, messageId],
    );
    await this.sqlite.execute('UPDATE chats SET updated_at = ? WHERE id = ?', [this.clock.nowIso(), chatId]);

    return rowToMessage({ ...existing, content, status, token_count: tokenCount ?? null, metadata: metadata ? JSON.stringify(metadata) : null });
  }

  /**
   * Phase 8, `docs/decisions.md` #7a — bulk delete-sync; unknown ids are
   * silently not counted (idempotent-batch spirit, matching
   * `appendMessages`). Empty `messageIds` short-circuits without a query.
   */
  async deleteMessages(chatId: string, messageIds: string[]): Promise<{ deleted: number }> {
    if (messageIds.length === 0) return { deleted: 0 };
    const placeholders = messageIds.map(() => '?').join(', ');
    const rows = await this.sqlite.query<{ id: string }>(
      `DELETE FROM chat_messages WHERE chat_id = ? AND id IN (${placeholders}) RETURNING id`,
      [chatId, ...messageIds],
    );
    return { deleted: rows.length };
  }

  /**
   * Phase 8 — exports one chat's full state, shaped to feed straight back
   * into `upsertChat()`/`appendMessages()` for a round-trip restore (see
   * `docs/decisions.md`'s "Export/backup" entry). Resolves `null` if the
   * chat doesn't exist.
   */
  async exportChat(chatId: string): Promise<ChatExport | null> {
    const chat = await this.getChat(chatId);
    if (!chat) return null;
    return { chat, messages: await this.getMessages(chatId) };
  }

  /** Phase 8 — exports every chat, paginated the same way as `listChats()`. */
  async exportChats(options?: { limit?: number; offset?: number }): Promise<ChatExport[]> {
    const chats = await this.listChats(options);
    const exports: ChatExport[] = [];
    for (const chat of chats) {
      exports.push({ chat, messages: await this.getMessages(chat.id) });
    }
    return exports;
  }
}
