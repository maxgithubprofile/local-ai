/**
 * "Export logs" button handler — see `docs/guides/logging-and-export.md`.
 * `exportLogs()` returns plain data; this module owns turning that into a
 * file and handing it off to native save/share UI, same "library returns
 * data, host app owns native UX" split as `chats.ts`'s send flow doesn't
 * need but `mode-b-chat.ts`'s sync does.
 */
import { Filesystem, Directory } from '@capacitor/filesystem';
import { getClient } from './local-ai-setup.js';

/**
 * Writes every persisted log entry to a timestamped JSON file in the app's
 * cache directory and returns its `file://` URI. Wire this to a button's
 * `onClick`; hand the returned URI to whichever share plugin the app
 * already depends on (e.g. `@capacitor/share`'s `Share.share({ url })`) to
 * actually present the OS share sheet — that plugin choice is the host
 * app's, not `local-ai`'s (hexagonal boundary, CLAUDE.md).
 */
export async function exportLogsToFile(): Promise<string> {
  const client = await getClient();
  const entries = await client.exportLogs();

  const { uri } = await Filesystem.writeFile({
    path: `local-ai-logs-${Date.now()}.json`,
    data: JSON.stringify(entries, null, 2),
    directory: Directory.Cache,
    encoding: 'utf8' as never, // @capacitor/filesystem's Encoding enum — 'utf8' string works at runtime, avoids importing the enum just for one call
  });
  console.log(`Exported ${entries.length} log entries to ${uri}`);
  return uri;
}
