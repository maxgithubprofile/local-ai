/**
 * Mode A (library-as-source-of-truth) chat management — TZ §9.2/§9.6.
 * Demonstrates 2+ independent chats and the concurrency/cancel/error rules
 * from `docs/guides/multiple-chats.md`.
 */
import { getClient } from './local-ai-setup.js';
import { describeEligibilityFailure } from './eligibility-screen.js';
import { DeviceNotEligibleError, RuntimeBusyError } from 'local-ai';

export async function bootstrapChats(): Promise<void> {
  const client = await getClient();

  try {
    await client.refreshManifest();
    await client.ensureReady({
      onProgress: (p) => console.log(`downloading ${p.kind}: ${p.percent}%`),
    });
  } catch (err) {
    if (err instanceof DeviceNotEligibleError) {
      const screen = describeEligibilityFailure([err.message]);
      console.warn(screen.title, screen.detail);
      return;
    }
    throw err;
  }

  // Two independent chats — nothing special about having more than one,
  // this just demonstrates listChats()/createChat() aren't singleton-scoped.
  const tripChat = await client.createChat({ title: 'Trip planning' });
  const recipeChat = await client.createChat({
    title: 'Recipe ideas',
    systemPrompt: 'You are a helpful cooking assistant.',
  });

  await sendAndLog(tripChat.id, 'Suggest a 3-day itinerary for Lisbon.');
  await sendAndLog(recipeChat.id, 'What can I make with chickpeas and spinach?');

  const chats = await client.listChats();
  console.log(
    'All chats:',
    chats.map((c) => c.title),
  );
}

async function sendAndLog(chatId: string, text: string): Promise<void> {
  const client = await getClient();
  const controller = new AbortController();

  try {
    const stream = client.sendMessage(chatId, text, { signal: controller.signal });
    for await (const token of stream) process.stdout.write(token.token);
    const message = await stream.result;
    console.log(`\n[${message.status}]`);
  } catch (err) {
    if (err instanceof RuntimeBusyError) {
      // Another chat is mid-generation — this example just logs; a real
      // app would queue the send or disable the input until free.
      console.warn('Runtime busy — try again once the other chat finishes.');
      return;
    }
    throw err;
  }
}
