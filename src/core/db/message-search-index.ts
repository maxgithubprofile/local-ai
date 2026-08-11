import type { ChatSearchHit } from '../conversations/conversation.types.js';

/**
 * Full-text search over `chat_messages` — Phase 8 addition, no TZ section
 * (see `docs/decisions.md`'s "Full-text search" entry). Two implementations
 * share this interface, same shape as `VectorStore`'s `sqlite-vec`/
 * brute-force split: `Fts5MessageSearchIndex` (primary, real SQLite FTS5)
 * and `LikeMessageSearchIndex` (fallback, `LIKE '%...%'`).
 * `createMessageSearchIndex()` picks between them opportunistically.
 */
export interface MessageSearchIndex {
  /**
   * @param query Free-text search term(s).
   * @param options.chatId Restrict to a single chat; omit to search every chat.
   * @param options.limit Max hits to return — default 20.
   */
  search(query: string, options?: { chatId?: string; limit?: number }): Promise<ChatSearchHit[]>;
}
