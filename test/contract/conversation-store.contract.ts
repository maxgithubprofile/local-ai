import { beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from '../../src/core/conversations/conversation-store.js';
import type { SqlitePort } from '../../src/core/ports/sqlite.port.js';
import type { ClockPort } from '../../src/core/ports/clock.port.js';

/**
 * Shared `ConversationStore` scenarios — TZ §8.1/§9.1-§9.2 — CRUD +
 * cascade-delete, parametrized over every `SqlitePort` implementation with
 * migrations already applied.
 */
export function defineConversationStoreContract(create: () => Promise<{ sqlite: SqlitePort; clock: ClockPort }>) {
  describe('ConversationStore contract', () => {
    let store: ConversationStore;
    let sqlite: SqlitePort;
    let clock: ClockPort & { advance?: (ms: number) => void };

    beforeEach(async () => {
      const ctx = await create();
      sqlite = ctx.sqlite;
      clock = ctx.clock;
      store = new ConversationStore(ctx.sqlite, ctx.clock);
    });

    it('createChat() with no options creates a chat with a generated id and default title', async () => {
      const chat = await store.createChat();
      expect(chat.id).toBeTruthy();
      expect(chat.title).toBe('New chat');
      expect(await store.getChat(chat.id)).toEqual(chat);
    });

    it('createChat() honors a caller-supplied id, title, and metadata', async () => {
      const chat = await store.createChat({ id: 'my-chat', title: 'Trip planning', metadata: { pinned: true } });
      expect(chat.id).toBe('my-chat');
      expect(chat.title).toBe('Trip planning');
      expect(chat.metadata).toEqual({ pinned: true });
    });

    it('createChat() with a systemPrompt inserts it as the first message', async () => {
      const chat = await store.createChat({ systemPrompt: 'You are a helpful assistant.' });
      const messages = await store.getMessages(chat.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'system', content: 'You are a helpful assistant.' });
    });

    it('getChat() returns null for an unknown id', async () => {
      expect(await store.getChat('does-not-exist')).toBeNull();
    });

    it('listChats() returns chats ordered by updatedAt descending by default', async () => {
      const a = await store.createChat({ id: 'a', title: 'A' });
      clock.advance?.(1000);
      const b = await store.createChat({ id: 'b', title: 'B' });

      const chats = await store.listChats();
      expect(chats.map((c) => c.id)).toEqual([b.id, a.id]);
    });

    it('renameChat() updates the title and updatedAt', async () => {
      const chat = await store.createChat({ title: 'Old' });
      await store.renameChat(chat.id, 'New');
      const updated = await store.getChat(chat.id);
      expect(updated?.title).toBe('New');
    });

    it('deleteChat() removes the chat and cascades to its messages', async () => {
      const chat = await store.createChat({ systemPrompt: 'sys' });
      await sqlite.execute(
        'INSERT INTO chat_messages (chat_id, id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
        [chat.id, 'm1', 'user', 'hi', '2026-01-01T00:00:00.000Z'],
      );

      await store.deleteChat(chat.id);

      expect(await store.getChat(chat.id)).toBeNull();
      expect(await store.getMessages(chat.id)).toEqual([]);
    });

    it('deleteChat() does not affect other chats messages', async () => {
      const keep = await store.createChat({ id: 'keep', systemPrompt: 'sys' });
      const gone = await store.createChat({ id: 'gone', systemPrompt: 'sys' });

      await store.deleteChat(gone.id);

      expect(await store.getMessages(keep.id)).toHaveLength(1);
    });

    it('getMessages() supports limit and before pagination', async () => {
      const chat = await store.createChat();
      for (const [id, createdAt] of [
        ['m1', '2026-01-01T00:00:00.000Z'],
        ['m2', '2026-01-01T00:00:01.000Z'],
        ['m3', '2026-01-01T00:00:02.000Z'],
      ] as const) {
        await sqlite.execute(
          'INSERT INTO chat_messages (chat_id, id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
          [chat.id, id, 'user', id, createdAt],
        );
      }

      const firstTwo = await store.getMessages(chat.id, { limit: 2 });
      expect(firstTwo.map((m) => m.id)).toEqual(['m1', 'm2']);

      const beforeM3 = await store.getMessages(chat.id, { before: '2026-01-01T00:00:02.000Z' });
      expect(beforeM3.map((m) => m.id)).toEqual(['m1', 'm2']);
    });
  });
}
