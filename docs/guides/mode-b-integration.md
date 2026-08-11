# Mode B: `local-ai` as a context mirror

If your app already has its own chat history/database and its own UI for it, you don't need
`local-ai` to be the source of truth — you can use it purely as memory for the model, mirroring your
own ids (TZ §9.6).

## The three calls

```ts
// 1. Mirror a chat that already exists in your own DB — idempotent by id.
await client.upsertChat({ id: 'chat-42', title: 'Portugal trip' });

// 2. Backfill whatever history you already have. Safe to call repeatedly with
//    overlapping batches — duplicates by (chatId, id) are silently skipped, nothing is overwritten.
const { inserted, skippedExisting } = await client.appendMessages('chat-42', historyFromYourOwnDb);

// 3. New message — your app already decided the ids (e.g. your DB's autoincrement/UUID).
const stream = client.sendMessage('chat-42', text, {
  userMessageId: 'msg-501',
  assistantMessageId: 'msg-502',
});
for await (const token of stream) yourOwnUi.appendToken(token.token);
const assistantMessage = await stream.result;
await yourOwnDb.save({ id: 'msg-502', role: 'assistant', content: assistantMessage.content, status: assistantMessage.status });
```

`local-ai` never "takes over" chat display — your own DB/UI stays the source of truth for what the
user sees; `local-ai` only accumulates the same messages under the same ids so it can build context
for the model. Because both sides use the same ids, syncing is just "does this id already exist here",
never a separate mapping table.

## What's explicitly out of scope

- **Editing already-saved message content.** `appendMessages`/`sendMessage` only *add* — a repeat call
  with an existing `(chatId, id)` is silently ignored, never overwrites. If your app lets users edit a
  past message, `local-ai`'s copy of that message will be stale until an explicit
  `updateMessage`/`deleteMessages` call — which doesn't exist yet (TZ §16, post-v1).
- **Deleting individual messages.** Only whole-chat `deleteChat()` is synced in v1.
- Whether Mode B ships in the first release at all is still an open product question
  (`docs/decisions.md` #16) — it's implemented and tested regardless, per `ROADMAP.md`'s framing of
  "implement now, decide the release scope separately."
