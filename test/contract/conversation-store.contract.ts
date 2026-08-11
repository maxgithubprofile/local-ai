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

    // --- addMessage / ConversationSyncApi (Mode B, TZ §9.2/§9.6) ---

    it('addMessage() inserts a new message and reports inserted: true', async () => {
      const chat = await store.createChat();
      const result = await store.addMessage(chat.id, {
        id: 'm1',
        role: 'user',
        content: 'hi',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(result).toEqual({ inserted: true });
      expect(await store.getMessages(chat.id)).toHaveLength(1);
    });

    it('addMessage() with an existing (chatId, id) is a no-op and reports inserted: false', async () => {
      const chat = await store.createChat();
      await store.addMessage(chat.id, { id: 'm1', role: 'user', content: 'first', createdAt: '2026-01-01T00:00:00.000Z' });
      const result = await store.addMessage(chat.id, {
        id: 'm1',
        role: 'user',
        content: 'different content — must be ignored',
        createdAt: '2026-01-01T00:00:01.000Z',
      });

      expect(result).toEqual({ inserted: false });
      const messages = await store.getMessages(chat.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe('first'); // original content preserved, never overwritten
    });

    it('addMessage() bumps the parent chat.updatedAt only when it actually inserts', async () => {
      const chat = await store.createChat({ id: 'c1' });
      clock.advance?.(5000);
      await store.addMessage(chat.id, { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:05.000Z' });
      const afterInsert = await store.getChat('c1');
      expect(afterInsert?.updatedAt).toBe('2026-01-01T00:00:05.000Z');

      clock.advance?.(5000);
      await store.addMessage(chat.id, { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:10.000Z' });
      const afterDuplicate = await store.getChat('c1');
      expect(afterDuplicate?.updatedAt).toBe(afterInsert?.updatedAt); // unchanged — duplicate was skipped
    });

    it('upsertChat() creates a chat with a caller-supplied id when none exists', async () => {
      const chat = await store.upsertChat({ id: 'mode-b-chat', title: 'From host app' });
      expect(chat.id).toBe('mode-b-chat');
      expect(await store.getChat('mode-b-chat')).toEqual(chat);
    });

    it('upsertChat() on an existing id updates only title/metadata/updatedAt, never touches messages', async () => {
      const chat = await store.upsertChat({ id: 'c1', title: 'Original' });
      await store.addMessage(chat.id, { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' });

      const updated = await store.upsertChat({ id: 'c1', title: 'Renamed', metadata: { pinned: true } });

      expect(updated.title).toBe('Renamed');
      expect(updated.metadata).toEqual({ pinned: true });
      expect(updated.createdAt).toBe(chat.createdAt); // unchanged
      expect(await store.getMessages('c1')).toHaveLength(1); // untouched
    });

    it('appendMessages() implicitly creates the chat if it does not exist yet', async () => {
      const result = await store.appendMessages('brand-new-chat', [
        { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
      ]);
      expect(result).toEqual({ inserted: 1, skippedExisting: 0 });
      expect(await store.getChat('brand-new-chat')).not.toBeNull();
    });

    it('appendMessages() dedups by id — repeated calls with overlapping ids are safe', async () => {
      const chat = await store.createChat();
      const batch1 = [
        { id: 'm1', role: 'user' as const, content: 'one', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'm2', role: 'assistant' as const, content: 'two', createdAt: '2026-01-01T00:00:01.000Z' },
      ];
      const first = await store.appendMessages(chat.id, batch1);
      expect(first).toEqual({ inserted: 2, skippedExisting: 0 });

      const batch2 = [
        ...batch1, // already present
        { id: 'm3', role: 'user' as const, content: 'three', createdAt: '2026-01-01T00:00:02.000Z' },
      ];
      const second = await store.appendMessages(chat.id, batch2);
      expect(second).toEqual({ inserted: 1, skippedExisting: 2 });
      expect(await store.getMessages(chat.id)).toHaveLength(3);
    });
  });
}
