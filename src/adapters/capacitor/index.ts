/**
 * Production adapters over real Capacitor plugins — TZ §3, §4. Import this
 * subpath (`local-ai/adapters/capacitor`) from an actual Capacitor app;
 * importing it from Node will fail at runtime since the underlying
 * `@capacitor/*`/`@capgo/*` packages aren't available there (use
 * `local-ai/adapters/node-testing` instead).
 *
 * `ClockPort`/`HashPort` deliberately have no *Capacitor-specific* adapter
 * — `SystemClockAdapter`/`WebCryptoHashAdapter` (re-exported below, real
 * implementations under `../shared/`) run unmodified in a WebView, so TZ
 * §3.1's tree doesn't need a dedicated `Capacitor*` file for either.
 */
export { CapacitorPlatformSupportAdapter } from './capacitor-platform-support.adapter.js';
export { CapgoDeviceInfoAdapter } from './capgo-device-info.adapter.js';
export { CapgoDownloaderAdapter } from './capgo-downloader.adapter.js';
export { CapacitorRangeDownloadAdapter } from './capacitor-range-download.adapter.js';
export { CapacitorFsAdapter } from './capacitor-fs.adapter.js';
export { CapacitorSqliteAdapter } from './capacitor-sqlite.adapter.js';
export { LlamaCppCapacitorAdapter } from './llama-cpp-capacitor.adapter.js';
export { CapacitorAppLifecycleAdapter } from './capacitor-app-lifecycle.adapter.js';
export { WebCryptoHashAdapter } from '../shared/web-crypto-hash.adapter.js';
export { SystemClockAdapter } from '../shared/system-clock.adapter.js';
