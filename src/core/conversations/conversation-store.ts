/**
 * Not implemented — Phase 3 (MVP `ConversationApi`) / Phase 5
 * (`ConversationSyncApi`), ROADMAP.md. SQL-backed implementation of
 * `chats`/`chat_messages` (TZ §8.1, §9.1-§9.2) via `SqlitePort`. Idempotency
 * for `appendMessages`/`upsertChat` relies on `INSERT OR IGNORE` on the
 * `(chat_id, id)` primary key, per TZ §8.1's comment on `chat_messages`.
 */
export class ConversationStore {
  async createChat(): Promise<never> {
    throw new Error('not implemented — see TZ §9.2, ROADMAP Phase 3');
  }
}
