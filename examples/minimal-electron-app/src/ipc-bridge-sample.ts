/**
 * Illustrative sample of how a host app might expose `local-ai` to its
 * renderer over IPC — **one way to do it, not a `local-ai`-owned API**.
 * IPC/`contextBridge` design is entirely the host app's concern (TZ v6
 * §6.1, same split drawn for Capacitor's WebView bridge) — `local-ai`
 * itself has no opinion on this file's shape and doesn't import it.
 *
 * Main process: register handlers once `getClient()` has resolved.
 */
import { ipcMain } from 'electron';
import { getClient } from './local-ai-setup.js';

export function registerIpcHandlers(): void {
  ipcMain.handle('local-ai:createChat', async (_event, title: string) => {
    const client = await getClient();
    return client.createChat({ title });
  });

  ipcMain.handle('local-ai:sendMessage', async (_event, chatId: string, text: string) => {
    const client = await getClient();
    const stream = client.sendMessage(chatId, text);
    // A real bridge would forward each token to the renderer via
    // `event.sender.send('local-ai:token', ...)` inside a `for await` loop
    // here, then resolve once `stream.result` settles — omitted for
    // brevity, this file is about the *shape* of the bridge, not a
    // full streaming-over-IPC implementation.
    return stream.result;
  });
}

/**
 * Preload script (runs in an isolated context with access to both
 * `ipcRenderer` and the renderer's `window`) — exposes a narrow, typed
 * surface rather than the raw `ipcRenderer`.
 *
 * ```ts
 * // preload.ts
 * import { contextBridge, ipcRenderer } from 'electron';
 *
 * contextBridge.exposeInMainWorld('localAi', {
 *   createChat: (title: string) => ipcRenderer.invoke('local-ai:createChat', title),
 *   sendMessage: (chatId: string, text: string) => ipcRenderer.invoke('local-ai:sendMessage', chatId, text),
 * });
 * ```
 */
