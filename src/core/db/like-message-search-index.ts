import type { SqlitePort } from '../ports/sqlite.port.js';
import type { ChatSearchHit } from '../conversations/conversation.types.js';
import { type ChatMessageRow, rowToMessage } from '../conversations/chat-message-row.js';
import type { MessageSearchIndex } from './message-search-index.js';

/** Escapes `%`/`_`/the escape character itself so a raw query never behaves as a `LIKE` wildcard pattern. */
function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * `LIKE`-based brute-force fallback for {@link MessageSearchIndex} — TZ
 * §9.5's "can build FTS5 on `chat_messages` if needed" note, Phase 8. No
 * ranking (`ORDER BY created_at DESC`, most recent first) and no
 * `snippet` — a substring scan, not a real search engine, but `O(n)` over
 * `content` is entirely adequate for a single user's local chat corpus,
 * same reasoning as `BruteForceVectorStore`. Ships unconditionally, used
 * whenever `createMessageSearchIndex()`'s FTS5 self-test fails.
 */
export class LikeMessageSearchIndex implements MessageSearchIndex {
  constructor(private readonly sqlite: SqlitePort) {}

  async search(query: string, options?: { chatId?: string; limit?: number }): Promise<ChatSearchHit[]> {
    const pattern = `%${escapeLikePattern(query)}%`;
    let sql = "SELECT * FROM chat_messages WHERE content LIKE ? ESCAPE '\\'";
    const params: unknown[] = [pattern];
    if (options?.chatId) {
      sql += ' AND chat_id = ?';
      params.push(options.chatId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(options?.limit ?? 20);

    const rows = await this.sqlite.query<ChatMessageRow>(sql, params);
    return rows.map((row) => ({ message: rowToMessage(row) }));
  }
}
