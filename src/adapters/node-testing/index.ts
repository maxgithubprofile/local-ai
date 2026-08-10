/**
 * Node-only adapters — used in `test/unit`, `test/integration`, and
 * `test/contract` (TZ §13), and importable by any Node-side dev tooling
 * that wants to exercise `local-ai/core` without a device. Never import
 * this subpath from a Capacitor app bundle.
 */
export { FakePlatformSupportAdapter } from './fake-platform-support.adapter.js';
export { FakeDeviceInfoAdapter } from './fake-device-info.adapter.js';
export { NodeRangeDownloadAdapter } from './node-range-download.adapter.js';
export { NodeFsAdapter } from './node-fs.adapter.js';
export { NodeSqliteAdapter } from './node-sqlite.adapter.js';
export { NodeLlamaCppAdapter } from './node-llama-cpp.adapter.js';
export { FakeClockAdapter } from './fake-clock.adapter.js';
export { WebCryptoHashAdapter } from './web-crypto-hash.adapter.js';
