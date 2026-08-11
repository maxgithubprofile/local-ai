/**
 * Assembles the full `LocalAiPorts` set once, at app startup, and creates
 * the shared `LocalAiClient` instance every other module imports. This is
 * the one place `local-ai/adapters/capacitor` gets imported — everything
 * else in this example talks to the plain `LocalAiClient` public API.
 */
import { LocalAiClient } from 'local-ai';
import {
  CapacitorPlatformSupportAdapter,
  CapgoDeviceInfoAdapter,
  CapgoDownloaderAdapter,
  CapacitorFsAdapter,
  CapacitorSqliteAdapter,
  LlamaCppCapacitorAdapter,
  CapacitorAppLifecycleAdapter,
  WebCryptoHashAdapter,
  SystemClockAdapter,
} from 'local-ai/adapters/capacitor';

export const ports = {
  platformSupport: new CapacitorPlatformSupportAdapter(),
  deviceInfo: new CapgoDeviceInfoAdapter(),
  downloadTransport: new CapgoDownloaderAdapter(),
  fileSystem: new CapacitorFsAdapter(),
  sqlite: new CapacitorSqliteAdapter(),
  llmRuntime: new LlamaCppCapacitorAdapter(),
  appLifecycle: new CapacitorAppLifecycleAdapter(),
  hash: new WebCryptoHashAdapter(),
  clock: new SystemClockAdapter(),
};

let clientPromise: Promise<LocalAiClient> | null = null;

/** Lazily creates the shared `LocalAiClient` — call sites just `await getClient()`. */
export function getClient(): Promise<LocalAiClient> {
  if (!clientPromise) {
    clientPromise = LocalAiClient.create({
      manifestUrl: 'https://example.com/local-ai-manifest.json', // replace with your own hosted manifest
      eligibilityPolicy: { no: 'block', tight: 'warn' },
      autoUnloadOnBackground: true, // this example app prioritizes memory over latency on refocus
      logging: { enabled: true }, // powers logs.ts's "export logs" button — see docs/guides/logging-and-export.md
      ports,
    });
  }
  return clientPromise;
}
