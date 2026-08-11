# Testing your `local-ai` integration without a device

Everything in `src/core/**` — and by extension everything your app calls on `LocalAiClient` — is
testable in plain Node, no emulator/device required (TZ §13). Use `local-ai/adapters/node-testing`
instead of `local-ai/adapters/capacitor` to assemble your `LocalAiPorts`.

## Fully offline, deterministic tests

For testing your *own* app logic around `local-ai` (chat UI state, retry logic, eligibility-gated
screens) without any real inference, use the fakes:

```ts
import { LocalAiClient } from 'local-ai';
import {
  FakePlatformSupportAdapter,
  FakeDeviceInfoAdapter,
  FakeLlmRuntimeAdapter,
  FakeAppLifecycleAdapter,
  NodeFsAdapter,
  NodeSqliteAdapter,
  NodeRangeDownloadAdapter,
} from 'local-ai/adapters/node-testing';
import { WebCryptoHashAdapter, SystemClockAdapter } from 'local-ai/adapters/capacitor'; // or node-testing — both re-export the same platform-generic adapters

const llmRuntime = new FakeLlmRuntimeAdapter();
llmRuntime.scriptedTokens = ['Hello', ', ', 'world!'];
llmRuntime.scriptedOutcome = 'complete'; // or 'error' / 'hang' to test your app's error/cancel handling

const ports = {
  platformSupport: new FakePlatformSupportAdapter({ platform: 'android', isNative: true, availablePlugins: ['LlamaCpp', 'CapacitorSQLite', 'CapacitorDownloader', 'DeviceInfo'] }),
  deviceInfo: new FakeDeviceInfoAdapter({ totalRamGb: 8, freeRamGb: 6, freeDiskBytes: 10e9, thermal: 'nominal', lowPowerMode: false }),
  downloadTransport: new NodeRangeDownloadAdapter(), // real Range-request transport against a local mock server, see below
  fileSystem: new NodeFsAdapter('/tmp/my-app-test'),
  sqlite: new NodeSqliteAdapter(':memory:'),
  llmRuntime,
  clock: new SystemClockAdapter(),
  hash: new WebCryptoHashAdapter(),
  appLifecycle: new FakeAppLifecycleAdapter(),
};

const client = await LocalAiClient.create({ manifestUrl: 'https://your-test-manifest.example', ports });
```

`FakeDeviceInfoAdapter.set(snapshot | null)` lets a single test simulate a low-RAM device, a thermal
`'critical'` state, or `deviceInfo` being unavailable entirely (`null`) — useful for exercising every
branch of your eligibility-gated UI without touching real hardware.

## Testing against a real download + a real manifest fetch

Stub `fetch` (e.g. with `vitest`'s `vi.stubGlobal('fetch', ...)`) to serve your manifest JSON, and spin
up a tiny local HTTP server for the artifact bytes — `NodeRangeDownloadAdapter` does real
`Range:`-request downloading against it, so `ensureModelReady()`'s full download+verify+load path runs
for real (with your own tiny test "model" file — nothing needs to be a real GGUF unless you're also
testing inference, see below). `test/integration/client/local-ai-client.test.ts` in this repo is a
complete worked example of exactly this pattern, including a mock HTTP server helper
(`test/integration/download/mock-http-server.ts`) that can drop connections mid-transfer to test your
own retry/error UI too.

## Testing against real inference

`NodeLlamaCppAdapter` (`local-ai/adapters/node-testing`) wraps `node-llama-cpp` for real GGUF
inference in Node — no Capacitor bridge involved, but genuinely running the model. Use a small
(0.1–0.5B parameter) fixture GGUF for fast tests; this repo's own test suite uses a ~1.2MB TinyStories
checkpoint (`stories260K.gguf`, from `ggml-org`'s own CI fixtures) that loads and generates in
milliseconds.

## What you cannot test this way

Anything that depends on the actual native plugin's on-device behavior — real RAM/thermal readings
from `@capgo/capacitor-device-info`, real background-download survival through a process kill, real
`sqlite-vec` extension loading on iOS. Those need `test/device-e2e/` (manual/emulator-only, never part
of `pnpm test`) and, ultimately, a real device pass before shipping — see `docs/adr/` for exactly
which of `local-ai`'s own internal assumptions are still only desk-verified for the same reason.
