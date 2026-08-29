# First run

## 1. Install

```bash
npm install local-ai
# plus whichever native plugins your platform adapter set needs, e.g.:
npm install @capacitor/core @capacitor/app @capacitor/filesystem \
  @capacitor-community/sqlite @capgo/capacitor-downloader @capgo/capacitor-device-info \
  llama-cpp-pro
```

`local-ai` never bundles a default model — you point it at a manifest URL you (or your backend)
control. See [manifest-format.md](./manifest-format.md) for what that manifest needs to contain.

## 2. Check the environment before committing to anything

```ts
import { LocalAiClient } from 'local-ai';
import { CapacitorPlatformSupportAdapter } from 'local-ai/adapters/capacitor';

const support = await LocalAiClient.checkSupport({
  platformSupport: new CapacitorPlatformSupportAdapter(),
});

if (!support.capabilities.inference) {
  // e.g. platform is 'web', or the LlamaCpp native plugin isn't registered
  // in this build. support.reasons has a human-readable explanation.
  showUnsupportedScreen(support.reasons);
  return;
}
```

`checkSupport()` needs no `manifestUrl` and does no network I/O — it's a pure "can this build even
run local-ai at all" check (TZ §6.1), safe to call as early as app boot. See
[support-and-eligibility.md](./support-and-eligibility.md) for the full picture, including the
*device*-eligibility check that comes later.

## 3. Assemble the full port set once

`local-ai/core` never imports a concrete adapter — you build the `LocalAiPorts` object from
`local-ai/adapters/capacitor`'s exports (or `local-ai/adapters/node-testing` for tests) and pass it to
`create()`. See the [Quickstart](../../README.md#quickstart) for the full list — every one of the 9
ports is required, `LocalAiClient.create()` throws `ConfigInvalidError` naming exactly which one is
missing if you forget one.

## 4. Create the client and get ready

```ts
const client = await LocalAiClient.create({ manifestUrl: 'https://example.com/manifest.json', ports });

await client.refreshManifest();
await client.ensureReady({
  onProgress: (p) => updateProgressBar(p.kind, p.percent),
});
```

`ensureReady()` = `ensureModelReady()` + `ensureEmbeddingReady()`. Each does, in order: the support
check again (defensively — `PlatformNotSupportedError` if inference isn't available),
device-eligibility check (throws `DeviceNotEligibleError` if the policy says to block), download +
sha256-verify the artifact (resumable, short-circuits if already downloaded), then loads it into the
native runtime. If the artifact is already downloaded and loaded from a previous run, this returns
almost immediately.

## 5. First chat, first message

```ts
const chat = await client.createChat({ title: 'My first chat' });

const stream = client.sendMessage(chat.id, 'Hello!');
for await (const token of stream) {
  process.stdout.write(token.token); // token.accumulatedContent has the running total too
}
const assistantMessage = await stream.result;
console.log(assistantMessage.status); // 'complete' | 'cancelled' | 'error'
```

The user's message is saved to `chat_messages` *before* generation starts — even if the very next line
throws `RuntimeBusyError` (another chat is mid-generation), your user's typed message is never lost.
See [multiple-chats.md](./multiple-chats.md) for the concurrency rule and session-cache behavior in
detail.
