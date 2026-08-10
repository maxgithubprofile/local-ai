/**
 * Production adapters over real Capacitor plugins — TZ §3, §4. Import this
 * subpath (`local-ai/adapters/capacitor`) from an actual Capacitor app;
 * importing it from Node will fail at runtime since the underlying
 * `@capacitor/*`/`@capgo/*` packages aren't available there (use
 * `local-ai/adapters/node-testing` instead).
 *
 * `ClockPort`/`HashPort` deliberately have no dedicated adapter here — per
 * TZ §3.1's tree they only appear under node-testing (`FakeClock` /
 * `WebCrypto Hash`); both are trivial/platform-generic enough that the
 * client wiring (Phase 1) reuses the same implementation on every platform
 * rather than duplicating it behind a Capacitor-specific file.
 */
export { CapacitorPlatformSupportAdapter } from './capacitor-platform-support.adapter.js';
export { CapgoDeviceInfoAdapter } from './capgo-device-info.adapter.js';
export { CapgoDownloaderAdapter } from './capgo-downloader.adapter.js';
export { CapacitorFsAdapter } from './capacitor-fs.adapter.js';
export { CapacitorSqliteAdapter } from './capacitor-sqlite.adapter.js';
export { LlamaCppCapacitorAdapter } from './llama-cpp-capacitor.adapter.js';
export { CapacitorAppLifecycleAdapter } from './capacitor-app-lifecycle.adapter.js';
