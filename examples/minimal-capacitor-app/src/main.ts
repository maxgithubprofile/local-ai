/**
 * App entry point, wiring the pieces above in the order a real app would
 * actually call them: environment check first (no network/manifest
 * needed), then the rest.
 */
import { checkAppCanRun } from './eligibility-screen.js';
import { bootstrapChats } from './chats.js';
import { bootstrapModeBChat } from './mode-b-chat.js';
import { checkForEmbeddingUpdate } from './embedding-update.js';

async function main(): Promise<void> {
  const unsupported = await checkAppCanRun();
  if (unsupported) {
    console.error(unsupported.title, '—', unsupported.detail);
    // A real app renders this instead of the chat UI and stops here.
    return;
  }

  await bootstrapChats(); // 2+ chats, Mode A
  await bootstrapModeBChat(); // Mode B — host-app-owned history
  await checkForEmbeddingUpdate(); // independent embedding update
}

main().catch((err) => console.error('minimal-capacitor-app failed:', err));
