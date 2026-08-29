/**
 * Assembles the full `LocalAiPorts` set once, at app startup, in the
 * Electron **main process** (never the renderer — no direct native/
 * filesystem access there without your own IPC bridge, TZ v6 §6.1,
 * docs/guides/electron-integration.md).
 *
 * Every port here, including `llmRuntime`, is real —
 * `LlamaCppProDesktopAdapter` wraps `llama-cpp-pro/desktop`'s sidecar
 * subsystem and was confirmed working end-to-end in this repo's own dev
 * environment against a real sidecar binary and a real GGUF model
 * (`docs/adr/0011-electron-sidecar-build.md`). The sidecar binary itself
 * still needs to actually exist on the machine running this app (staged
 * under `extraResources/sidecar/`, or built via `llama-cpp-pro`'s own
 * `build-variants.sh --variant desktop`, per that ADR's real recipe) —
 * `checkSupport()`'s `capabilities.inference` reports `false` honestly if
 * it doesn't, see `eligibility-screen.ts`.
 */
import { app, BrowserWindow } from 'electron';
import { LocalAiClient } from 'local-ai';
import {
  ElectronPlatformSupportAdapter,
  ElectronDeviceInfoAdapter,
  ElectronAppLifecycleAdapter,
  ElectronFsAdapter,
  ElectronSqliteAdapter,
  ElectronRangeDownloadAdapter,
  LlamaCppProDesktopAdapter,
  WebCryptoHashAdapter,
  SystemClockAdapter,
} from 'local-ai/adapters/electron';
import * as desktop from 'llama-cpp-pro/desktop';

const dataDir = app.getPath('userData');

let clientPromise: Promise<LocalAiClient> | null = null;

/** Lazily creates the shared `LocalAiClient` — call sites just `await getClient()`. */
export function getClient(): Promise<LocalAiClient> {
  if (!clientPromise) {
    clientPromise = createClient();
  }
  return clientPromise;
}

async function createClient(): Promise<LocalAiClient> {
  const client = await LocalAiClient.create({
    manifestUrl: 'https://example.com/local-ai-manifest.json', // replace with your own hosted manifest
    eligibilityPolicy: { no: 'block', tight: 'warn' },
    autoUnloadOnBackground: false, // desktop default — see docs/adr/0010's reasoning
    logging: { enabled: true }, // powers a "export logs" button, docs/guides/logging-and-export.md
    ports: {
      platformSupport: new ElectronPlatformSupportAdapter(app, desktop),
      deviceInfo: new ElectronDeviceInfoAdapter(dataDir),
      appLifecycle: new ElectronAppLifecycleAdapter(app, BrowserWindow, () => client.releaseRuntime()),
      fileSystem: new ElectronFsAdapter(dataDir),
      sqlite: new ElectronSqliteAdapter(`${dataDir}/local-ai.db`),
      downloadTransport: new ElectronRangeDownloadAdapter(),
      hash: new WebCryptoHashAdapter(),
      clock: new SystemClockAdapter(),
      llmRuntime: new LlamaCppProDesktopAdapter(desktop),
    },
  });

  return client;
}
