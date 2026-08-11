/**
 * Mode B — `local-ai` as a context mirror over an app-owned chat history
 * (TZ §9.6). This example pretends `yourOwnDb` is the app's real
 * database/store; only the pattern matters, not the fake implementation
 * below it.
 */
import { getClient } from './local-ai-setup.js';

interface OwnDbMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: string;
}

// Stand-in for the app's own persistence — a real app already has this.
const yourOwnDb = {
  chatId: 'support-thread-42',
  history: [] as OwnDbMessage[],
  async save(message: OwnDbMessage): Promise<void> {
    this.history.push(message);
  },
};

export async function bootstrapModeBChat(): Promise<void> {
  const client = await getClient();

  // 1. Mirror a chat that already exists in the host app's own DB.
  await client.upsertChat({ id: yourOwnDb.chatId, title: 'Support thread #42' });

  // 2. Backfill whatever history already exists there — safe to call
  //    repeatedly, e.g. on every app start, since duplicates by id are skipped.
  if (yourOwnDb.history.length > 0) {
    await client.appendMessages(yourOwnDb.chatId, yourOwnDb.history);
  }

  // 3. New message — ids come from the host app, not local-ai.
  const userMessageId = `msg-${Date.now()}-user`;
  const assistantMessageId = `msg-${Date.now()}-assistant`;
  const text = 'My order still shows "processing" after a week — what should I do?';

  await yourOwnDb.save({ id: userMessageId, role: 'user', content: text, createdAt: new Date().toISOString() });

  const stream = client.sendMessage(yourOwnDb.chatId, text, { userMessageId, assistantMessageId });
  let full = '';
  for await (const token of stream) full += token.token;
  const assistantMessage = await stream.result;

  // The host app's own DB stays the source of truth for what the user sees.
  await yourOwnDb.save({
    id: assistantMessageId,
    role: 'assistant',
    content: assistantMessage.content,
    createdAt: new Date().toISOString(),
  });

  console.log('Mode B round trip complete:', full === assistantMessage.content);
}
