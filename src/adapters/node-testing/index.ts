/**
 * Node-only adapters — used in `test/unit`, `test/integration`, and
 * `test/contract` (TZ §13), and importable by any Node-side dev tooling
 * that wants to exercise `local-ai/core` without a device. Everything here
 * except the two platform-generic re-exports at the bottom
 * (`WebCryptoHashAdapter`/`SystemClockAdapter`, from `../shared/`) is
 * Node-specific — never import the rest of this subpath from a Capacitor
 * app bundle.
 */
export { FakePlatformSupportAdapter } from './fake-platform-support.adapter.js';
export { FakeDeviceInfoAdapter } from './fake-device-info.adapter.js';
export { NodeRangeDownloadAdapter } from './node-range-download.adapter.js';
export { NodeFsAdapter } from './node-fs.adapter.js';
export { NodeSqliteAdapter } from './node-sqlite.adapter.js';
export { NodeLlamaCppAdapter } from './node-llama-cpp.adapter.js';
export { FakeLlmRuntimeAdapter } from './fake-llm-runtime.adapter.js';
export { FakeAppLifecycleAdapter } from './fake-app-lifecycle.adapter.js';
export { FakeClockAdapter } from './fake-clock.adapter.js';
export { WebCryptoHashAdapter } from '../shared/web-crypto-hash.adapter.js';
export { SystemClockAdapter } from '../shared/system-clock.adapter.js';
