export type { PlatformSupportPort } from './platform-support.port.js';
export type { DeviceInfoPort } from './device-info.port.js';
export type { DownloadTransportPort } from './download-transport.port.js';
export type { FileSystemPort } from './filesystem.port.js';
export type { SqlitePort, SqliteRow } from './sqlite.port.js';
export type { LlmRuntimePort, KvCacheQuant } from './llm-runtime.port.js';
export type { ClockPort } from './clock.port.js';
export type { HashPort, IncrementalHasher } from './hash.port.js';
export type { AppLifecyclePort } from './app-lifecycle.port.js';
export type { FastVerifyPort } from './fast-verify.port.js';

import type { PlatformSupportPort } from './platform-support.port.js';
import type { DeviceInfoPort } from './device-info.port.js';
import type { DownloadTransportPort } from './download-transport.port.js';
import type { FileSystemPort } from './filesystem.port.js';
import type { SqlitePort } from './sqlite.port.js';
import type { LlmRuntimePort } from './llm-runtime.port.js';
import type { ClockPort } from './clock.port.js';
import type { HashPort } from './hash.port.js';
import type { AppLifecyclePort } from './app-lifecycle.port.js';
import type { FastVerifyPort } from './fast-verify.port.js';

/**
 * All ports `LocalAiClient` depends on, aggregated so `LocalAiConfig.ports`
 * (TZ §10) can override any subset — e.g. tests inject
 * `node-testing` adapters wholesale via `Partial<LocalAiPorts>`.
 */
export interface LocalAiPorts {
  platformSupport: PlatformSupportPort;
  deviceInfo: DeviceInfoPort;
  downloadTransport: DownloadTransportPort;
  fileSystem: FileSystemPort;
  sqlite: SqlitePort;
  llmRuntime: LlmRuntimePort;
  clock: ClockPort;
  hash: HashPort;
  appLifecycle: AppLifecyclePort;
  /** Optional — see `FastVerifyPort`'s own doc comment. `DownloadEngine`
   *  falls back to the portable `readChunks()`+`HashPort` path when this
   *  is omitted. */
  fastVerify?: FastVerifyPort;
}
