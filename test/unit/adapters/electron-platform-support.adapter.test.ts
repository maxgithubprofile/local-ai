import { describe, expect, it } from 'vitest';
import { ElectronPlatformSupportAdapter } from '../../../src/adapters/electron/electron-platform-support.adapter.js';

describe('ElectronPlatformSupportAdapter', () => {
  it('isNativePlatform() is true — Electron main process is first-class, not degraded (TZ v6 §6.1)', () => {
    const adapter = new ElectronPlatformSupportAdapter({} as never, {
      getResourcesPathForApp: () => '/resources',
      assertSidecarBinary: () => '/resources/sidecar/win32-x64-cpu.exe',
    });
    expect(adapter.isNativePlatform()).toBe(true);
  });

  it("getPlatform() returns 'electron'", () => {
    const adapter = new ElectronPlatformSupportAdapter({} as never, {
      getResourcesPathForApp: () => '/resources',
      assertSidecarBinary: () => '/resources/sidecar/win32-x64-cpu.exe',
    });
    expect(adapter.getPlatform()).toBe('electron');
  });

  it("isPluginAvailable('LlamaCpp') is true when assertSidecarBinary() resolves a real binary", () => {
    const adapter = new ElectronPlatformSupportAdapter({} as never, {
      getResourcesPathForApp: () => '/resources',
      assertSidecarBinary: () => '/resources/sidecar/win32-x64-cpu.exe',
    });
    expect(adapter.isPluginAvailable('LlamaCpp')).toBe(true);
  });

  it("isPluginAvailable('LlamaCpp') is false when assertSidecarBinary() throws — no built sidecar for this OS/arch/backend (docs/adr/0011)", () => {
    const adapter = new ElectronPlatformSupportAdapter({} as never, {
      getResourcesPathForApp: () => '/resources',
      assertSidecarBinary: () => {
        throw new Error('llama-cpp-pro sidecar missing at /resources/sidecar/win32-x64-cpu.exe');
      },
    });
    expect(adapter.isPluginAvailable('LlamaCpp')).toBe(false);
  });

  it.each(['CapacitorSQLite', 'CapacitorDownloader', 'DeviceInfo', 'AnythingElse'])(
    "isPluginAvailable('%s') is true — no Capacitor plugin registry on Electron, sql/download/fs are always plain Node",
    (pluginName) => {
      const adapter = new ElectronPlatformSupportAdapter({} as never, {
        getResourcesPathForApp: () => '/resources',
        assertSidecarBinary: () => {
          throw new Error('irrelevant to non-inference capabilities');
        },
      });
      expect(adapter.isPluginAvailable(pluginName)).toBe(true);
    },
  );
});
