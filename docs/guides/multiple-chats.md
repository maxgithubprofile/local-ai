# Multiple chats

## Create, list, switch, delete

```ts
const chatA = await client.createChat({ title: 'Trip planning' });
const chatB = await client.createChat({ title: 'Recipe ideas', systemPrompt: 'You are a chef.' });

const chats = await client.listChats({ orderBy: 'updatedAt' }); // most recently active first, by default
const messages = await client.getMessages(chatA.id);

await client.renameChat(chatA.id, 'Portugal trip');
await client.deleteChat(chatB.id); // cascades to its messages and session-cache file
```

There's no explicit "switch to chat X" call — you just call `sendMessage(chatId, ...)` with whichever
`chatId` you want; `local-ai` figures out internally whether it can reuse a hot session or needs to
replay history.

## Concurrency: one runtime, one generation at a time

```ts
const first = client.sendMessage(chatA.id, 'Hi');
const second = client.sendMessage(chatB.id, 'Hi'); // fails — the LLM context is busy with the first
await second.result; // rejects with RuntimeBusyError
```

There is exactly one native LLM context — generating in two chats "at once" isn't possible (TZ §9.4).
`second`'s user message is still saved to `chat_messages` even though generation never started (TZ
§9.8) — you won't lose what the user typed, you just won't get a reply for it until you retry. Build a
send-queue or disable the input while a generation is in flight; `local-ai` doesn't do this for you.

## Session-cache: why the second message in a chat is faster

Switching *back* to a chat you were just in reuses the native runtime's KV cache via
`saveSession()`/`loadSession()` instead of replaying the whole history as a fresh prompt (TZ §9.3).
v1 caches exactly **one** "hot" chat — switching to chat B while chat A was hot evicts A's session
file reference (the on-disk file itself isn't touched; only the in-memory pointer moves). If a session
file is missing, corrupted, or was saved under a different model version, `local-ai` silently falls
back to rebuilding the prompt from SQL history — this is never visible as an error, just a slower
first response after the switch.

## Cancellation

```ts
const controller = new AbortController();
const stream = client.sendMessage(chat.id, text, { signal: controller.signal });
cancelButton.onclick = () => controller.abort();

const message = await stream.result;
// message.status === 'cancelled' — message.content has whatever was generated before the abort,
// it is NOT discarded (most chat UIs show "you stopped this response" with the partial text).
```

## Idempotent retries

```ts
await client.sendMessage(chat.id, text, {
  userMessageId: 'my-own-id-1',
  assistantMessageId: 'my-own-id-2',
});
```

Pass your own ids if you want a retried `sendMessage()` call (after a network blip, app restart,
whatever) to be safely idempotent — a repeat with the same `(chatId, id)` pair is a silent no-op on
the message-save side, not a duplicate.
