/**
 * Production adapters for Electron's main process — TZ v6 §6.1,
 * `ROADMAP.md`'s "Electron desktop support" section. Import this subpath
 * (`local-ai/adapters/electron`) from an Electron app's main process only
 * (never the renderer — no direct native/filesystem access there without
 * the host app's own IPC bridge, same split Capacitor's WebView draws).
 *
 * `SqlitePort`/`FilesystemPort`/`DownloadTransportPort` are re-exported
 * from `../node-testing` unmodified (ELEC.1.1b) rather than duplicated —
 * they're already real, working, plain-Node implementations with nothing
 * Electron-specific to add. `LlamaCppProDesktopAdapter` wraps
 * `llama-cpp-pro/desktop`'s sidecar subsystem for `LlmRuntimePort` — see
 * `docs/adr/0011-electron-sidecar-build.md`/`0012-electron-sidecar-streaming.md`
 * for the real build recipe and protocol capabilities/gaps this
 * implementation is based on; `node-llama-cpp`/`NodeLlamaCppAdapter`
 * remains a Node-side test tool only (TZ §13.1) and must not be
 * substituted here even temporarily.
 */
export { ElectronPlatformSupportAdapter } from './electron-platform-support.adapter.js';
export { ElectronDeviceInfoAdapter } from './electron-device-info.adapter.js';
export { ElectronAppLifecycleAdapter } from './electron-app-lifecycle.adapter.js';
export { LlamaCppProDesktopAdapter } from './llama-cpp-pro-desktop.adapter.js';
export type { LlamaCppProDesktopModule } from './llama-cpp-pro-desktop.adapter.js';
export { NodeFsAdapter as ElectronFsAdapter } from '../node-testing/node-fs.adapter.js';
export { NodeSqliteAdapter as ElectronSqliteAdapter } from '../node-testing/node-sqlite.adapter.js';
export { NodeRangeDownloadAdapter as ElectronRangeDownloadAdapter } from '../node-testing/node-range-download.adapter.js';
export { WebCryptoHashAdapter } from '../shared/web-crypto-hash.adapter.js';
export { SystemClockAdapter } from '../shared/system-clock.adapter.js';
