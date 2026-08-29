/**
 * App entry point — Electron main process. Wires the pieces above in the
 * order a real app would actually call them: environment check first (no
 * network/manifest needed), then everything else. `app.whenReady()` is
 * Electron's own boot gate, unrelated to `local-ai`.
 */
import { app } from 'electron';
import { checkAppCanRun } from './eligibility-screen.js';
import { getClient } from './local-ai-setup.js';

async function main(): Promise<void> {
  const unsupported = await checkAppCanRun();
  if (unsupported) {
    // A real app renders this instead of (or alongside) the chat UI.
    console.log(unsupported.title, '—', unsupported.detail);
  }

  const client = await getClient();
  await client.refreshManifest();

  // Chat CRUD, downloads, eligibility, lifecycle, and chat completion all
  // work against this real client, real sidecar included — see
  // minimal-capacitor-app/src/chats.ts for the fuller multi-chat/
  // cancellation-handling pattern this example deliberately doesn't
  // duplicate (the `LocalAiClient` API surface is identical across
  // platforms by design, TZ §10). One caveat unique to Electron, not
  // mobile: session-cache reuse doesn't speed up a second message in the
  // same chat here (docs/adr/0012, ledger row #26 — the sidecar has no
  // KV-cache persistence endpoint), so don't expect the same "second
  // response is faster" behavior TZ §9.3 promises on Android/iOS.
  const chat = await client.createChat({ title: 'Example chat' });
  const stream = client.sendMessage(chat.id, 'Hello!');
  for await (const token of stream) process.stdout.write(token.token);
  const message = await stream.result;
  console.log('\n[status]', message.status);
}

app.whenReady().then(main).catch((err: unknown) => console.error('minimal-electron-app failed:', err));
