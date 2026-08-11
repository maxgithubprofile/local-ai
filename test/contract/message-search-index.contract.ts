import { beforeEach, describe, expect, it } from 'vitest';
import type { MessageSearchIndex } from '../../src/core/db/message-search-index.js';
import type { SqlitePort } from '../../src/core/ports/sqlite.port.js';

/**
 * Shared `MessageSearchIndex` scenarios — Phase 8, `docs/decisions.md`'s
 * "Full-text search" entry — parametrized over every implementation
 * (`Fts5MessageSearchIndex`/`LikeMessageSearchIndex`). Only assertions true
 * of *both* implementations belong here (e.g. no ranking-order assertions,
 * since only FTS5 ranks by relevance) — capability-specific behavior
 * (`snippet`) is covered in each implementation's own dedicated test file.
 */
export function defineMessageSearchIndexContract(
  create: () => Promise<{ sqlite: SqlitePort; index: MessageSearchIndex }>,
) {
  describe('MessageSearchIndex contract', () => {
    let sqlite: SqlitePort;
    let index: MessageSearchIndex;

    beforeEach(async () => {
      const ctx = await create();
      sqlite = ctx.sqlite;
      index = ctx.index;
    });

    async function seedChat(chatId: string): Promise<void> {
      await sqlite.execute('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        chatId,
        chatId,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ]);
    }

    async function seedMessage(chatId: string, id: string, content: string, createdAt: string): Promise<void> {
      await sqlite.execute(
        'INSERT INTO chat_messages (chat_id, id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
        [chatId, id, 'user', content, createdAt],
      );
    }

    it('search() finds a message by a substring of its content', async () => {
      await seedChat('c1');
      await seedMessage('c1', 'm1', 'the quick brown fox jumps over the lazy dog', '2026-01-01T00:00:00.000Z');
      await seedMessage('c1', 'm2', 'completely unrelated content', '2026-01-01T00:00:01.000Z');

      const hits = await index.search('brown fox');

      expect(hits.map((h) => h.message.id)).toEqual(['m1']);
    });

    it('search() with no match returns an empty array', async () => {
      await seedChat('c1');
      await seedMessage('c1', 'm1', 'hello world', '2026-01-01T00:00:00.000Z');

      expect(await index.search('nonexistent-term-xyz')).toEqual([]);
    });

    it('search() restricts to options.chatId when given', async () => {
      await seedChat('c1');
      await seedChat('c2');
      await seedMessage('c1', 'm1', 'shared keyword here', '2026-01-01T00:00:00.000Z');
      await seedMessage('c2', 'm2', 'shared keyword here too', '2026-01-01T00:00:00.000Z');

      const hits = await index.search('shared keyword', { chatId: 'c1' });

      expect(hits.map((h) => h.message.id)).toEqual(['m1']);
    });

    it('search() respects options.limit', async () => {
      await seedChat('c1');
      for (let i = 0; i < 5; i++) {
        await seedMessage('c1', `m${i}`, `matching message number ${i}`, `2026-01-01T00:00:0${i}.000Z`);
      }

      const hits = await index.search('matching message', { limit: 2 });

      expect(hits).toHaveLength(2);
    });

    it('search() picks up a message added after the index was first used (sync stays live)', async () => {
      await seedChat('c1');
      await index.search('anything'); // forces lazy schema/index creation before the message below exists
      await seedMessage('c1', 'm1', 'freshly inserted searchable content', '2026-01-01T00:00:00.000Z');

      const hits = await index.search('freshly inserted');

      expect(hits.map((h) => h.message.id)).toEqual(['m1']);
    });
  });
}
