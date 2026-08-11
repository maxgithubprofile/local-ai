import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ChatSearchHit } from '../conversations/conversation.types.js';
import { type ChatMessageRow, rowToMessage } from '../conversations/chat-message-row.js';
import type { MessageSearchIndex } from './message-search-index.js';

const FTS_TABLE = 'chat_messages_fts';

/** Treats the whole query as one literal phrase (quoted) — the simplest safe way to pass free-text through FTS5's query syntax without a user's `"`/`-`/`*`/etc. being interpreted as FTS5 operators. */
function toFtsPhraseQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

/**
 * Primary {@link MessageSearchIndex} implementation — a real SQLite FTS5
 * external-content virtual table over `chat_messages` (Phase 8, see
 * `docs/decisions.md`'s "Full-text search" entry). `content='chat_messages',
 * content_rowid='rowid'` keeps the index itself tiny (no duplicated text)
 * and lets `AFTER INSERT/UPDATE/DELETE` triggers on `chat_messages` keep it
 * in sync automatically — `sendMessage()`/`appendMessages()`/
 * `updateMessage()`/`deleteMessages()`/`deleteChat()` never need to know
 * this index exists. Schema (table + triggers) is created lazily and
 * idempotently on first use, **not** as a numbered migration — see this
 * class's `docs/decisions.md` entry for why an FTS5-assuming migration
 * would be unsafe on an adapter that doesn't have the module compiled in.
 */
export class Fts5MessageSearchIndex implements MessageSearchIndex {
  private schemaEnsured = false;

  constructor(private readonly sqlite: SqlitePort) {}

  private async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;

    const existing = await this.sqlite.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [FTS_TABLE],
    );
    if (existing.length === 0) {
      await this.sqlite.execute(
        `CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(content, content='chat_messages', content_rowid='rowid')`,
      );
      // Backfills from every chat_messages row that existed before this
      // index did (e.g. an app upgrading into Phase 8 with existing chats).
      await this.sqlite.execute(`INSERT INTO ${FTS_TABLE}(${FTS_TABLE}) VALUES ('rebuild')`);
    }

    // Keep the index in sync with chat_messages regardless of which
    // higher-level method issued the write (sendMessage/appendMessages/
    // updateMessage/deleteMessages/deleteChat all end up as plain
    // INSERT/UPDATE/DELETE against this same table).
    await this.sqlite.execute(`
      CREATE TRIGGER IF NOT EXISTS ${FTS_TABLE}_ai AFTER INSERT ON chat_messages BEGIN
        INSERT INTO ${FTS_TABLE}(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
    await this.sqlite.execute(`
      CREATE TRIGGER IF NOT EXISTS ${FTS_TABLE}_ad AFTER DELETE ON chat_messages BEGIN
        INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
    `);
    await this.sqlite.execute(`
      CREATE TRIGGER IF NOT EXISTS ${FTS_TABLE}_au AFTER UPDATE ON chat_messages BEGIN
        INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO ${FTS_TABLE}(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

    this.schemaEnsured = true;
  }

  async search(query: string, options?: { chatId?: string; limit?: number }): Promise<ChatSearchHit[]> {
    await this.ensureSchema();

    let sql = `
      SELECT cm.*, snippet(${FTS_TABLE}, 0, '[', ']', '…', 8) AS __snippet
      FROM ${FTS_TABLE} f
      JOIN chat_messages cm ON cm.rowid = f.rowid
      WHERE f MATCH ?
    `;
    const params: unknown[] = [toFtsPhraseQuery(query)];
    if (options?.chatId) {
      sql += ' AND cm.chat_id = ?';
      params.push(options.chatId);
    }
    sql += ' ORDER BY rank LIMIT ?';
    params.push(options?.limit ?? 20);

    const rows = await this.sqlite.query<ChatMessageRow & { __snippet: string }>(sql, params);
    return rows.map((row) => ({ message: rowToMessage(row), snippet: row.__snippet }));
  }
}
