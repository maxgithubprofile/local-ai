import { describe, expect, it, vi } from 'vitest';

/**
 * Regression for two real on-device bugs (forta.chat AI-chat model
 * download, 2026-08-19): `@capgo/capacitor-downloader`'s actual Android
 * source reports `downloadProgress` as a `0..1` fraction
 * (`bytesDownloaded / bytesTotal`, `CapacitorDownloaderPlugin.java`), not
 * `0-100` percent as this adapter used to assume — the download UI stayed
 * stuck showing "0%" for the entire multi-minute transfer of a real 2.3GB
 * model file. `checkStatus()` similarly returns raw
 * `{status: <DownloadManager.STATUS_* int>, bytesDownloaded, bytesTotal}`,
 * not the `{progress, state}` shape this file declared. Never caught by
 * Node tests — there is no fake for this adapter (CLAUDE.md's testing rule:
 * real Capacitor bridge behavior belongs in test/device-e2e/, this is
 * exactly that kind of gap). Mocks the plugin surface with the *real*
 * shapes found by reading the plugin's Java source, so this is testable
 * without a device — the bug was in unit conversion, not native behavior.
 */

const listeners: Record<string, (e: unknown) => void> = {};

// registerPlugin() is called once at module load (module-level singleton in
// capgo-downloader.adapter.ts) — always returning the SAME mock object here
// (not a fresh one per call) so tests can reach into it via `mockPlugin`.
const mockPlugin = {
  download: vi.fn().mockResolvedValue({ id: 'dl1', status: 1 }),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  checkStatus: vi.fn().mockResolvedValue({ status: 2, bytesDownloaded: 512, bytesTotal: 2048 }),
  addListener: vi.fn().mockImplementation((eventName: string, fn: (e: unknown) => void) => {
    listeners[eventName] = fn;
    return Promise.resolve({ remove: vi.fn() });
  }),
};

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => mockPlugin,
}));

const { CapgoDownloaderAdapter } = await import('../../../src/adapters/capacitor/capgo-downloader.adapter.js');

describe('CapgoDownloaderAdapter', () => {
  it('supportsResume is false — the native plugin has no pause()/resume() on Android', () => {
    expect(new CapgoDownloaderAdapter().supportsResume).toBe(false);
  });

  it('onProgress() converts the real 0..1 fraction to 0-100 percent', async () => {
    const adapter = new CapgoDownloaderAdapter();
    const events: { id: string; progressPercent: number }[] = [];
    adapter.onProgress((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 0)); // let ensureNativeListeners() register

    listeners['downloadProgress']!({ id: 'dl1', progress: 0.1452569216489792 });

    expect(events).toEqual([{ id: 'dl1', progressPercent: 0.1452569216489792 * 100 }]);
    expect(Math.round(events[0]!.progressPercent)).toBe(15); // not 0
  });

  it('status() decodes the raw DownloadManager status int and computes percent from bytes', async () => {
    const adapter = new CapgoDownloaderAdapter();
    const result = await adapter.status('dl1');
    expect(result).toEqual({ state: 'running', progressPercent: 25 }); // 512/2048 * 100
  });

  it('status() maps SUCCESSFUL (8) to "done" and FAILED (16) to "error" with a message', async () => {
    mockPlugin.checkStatus.mockResolvedValueOnce({ status: 8, bytesDownloaded: 2048, bytesTotal: 2048 });
    expect(await new CapgoDownloaderAdapter().status('dl1')).toEqual({ state: 'done', progressPercent: 100 });

    mockPlugin.checkStatus.mockResolvedValueOnce({
      status: 16,
      bytesDownloaded: 100,
      bytesTotal: 2048,
      reason: 1008,
      reasonText: 'ERROR_HTTP_DATA_ERROR',
    });
    expect(await new CapgoDownloaderAdapter().status('dl1')).toEqual({
      state: 'error',
      progressPercent: (100 / 2048) * 100,
      errorMessage: 'ERROR_HTTP_DATA_ERROR',
    });
  });
});
