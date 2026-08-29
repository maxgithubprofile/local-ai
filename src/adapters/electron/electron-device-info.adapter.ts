import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type { DeviceInfoPort } from '../../core/ports/device-info.port.js';
import type { DeviceSnapshot } from '../../core/support/types.js';
import { NodeFsAdapter } from '../node-testing/node-fs.adapter.js';

/**
 * Reads the same "available" RAM figure `llama-cpp-pro/desktop`'s own
 * sidecar-memory IPC channel uses internally
 * (`node_modules/llama-cpp-pro/desktop/src/main/ipc-handlers.cjs`,
 * `getAvailableSystemBytes()`, not exported from that package's public API
 * so reimplemented here, confirmed in
 * `docs/adr/0009-electron-device-info.md`) rather than bare `os.freemem()`.
 * `os.freemem()` on macOS only counts truly-free pages, undercounting
 * reclaimable inactive/purgeable pages — using it directly would make
 * `EligibilityService` falsely reject models on a healthy Mac.
 */
function getAvailableSystemBytes(totalBytes: number): number {
  if (process.platform === 'darwin') {
    try {
      const out = execSync('vm_stat', { encoding: 'utf8' });
      const pageSizeMatch = /page size of\s+(\d+)/i.exec(out);
      const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 16384;
      const pages = (label: string): number => {
        const m = new RegExp(`${label}:\\s+([\\d.]+)`, 'i').exec(out);
        return m ? Math.floor(Number(m[1]!.replace(/\./g, '')) * pageSize) : 0;
      };
      const available =
        pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') + pages('Pages purgeable');
      if (available > 0) return Math.min(totalBytes, available);
    } catch {
      // fall through to the cross-platform estimate below
    }
  }

  try {
    const info = (process as { getSystemMemoryInfo?: () => { free: number } }).getSystemMemoryInfo?.();
    if (info && typeof info.free === 'number' && info.free > 0) {
      const chromeFreeBytes = info.free * 1024; // Chromium reports KB
      if (chromeFreeBytes > os.freemem()) return Math.min(totalBytes, chromeFreeBytes);
    }
  } catch {
    // ignore — process.getSystemMemoryInfo() only exists inside a real Electron process
  }

  return os.freemem();
}

/**
 * Real `DeviceInfoPort` for Electron's main process (TZ v6 §6.1, ELEC.1.3).
 * No native plugin involved — `os`/`process` are always available in the
 * main process, so this never returns `null` the way the soft-dependency
 * Capacitor adapters can. `thermal`/`lowPowerMode` stay `'unknown'`/
 * `undefined` (both already valid per `DeviceSnapshot`'s optional fields,
 * same fallback shape ADR 0004's mobile adapter uses) — desktop has no
 * OS-level thermal-throttling or low-power-mode signal to report, and
 * `docs/adr/0009-electron-device-info.md` deliberately rejected inventing a
 * synthetic one.
 */
export class ElectronDeviceInfoAdapter implements DeviceInfoPort {
  /**
   * Reuses `NodeFsAdapter.freeSpaceBytes()` (spike-confirmed working in
   * `docs/adr/0009-electron-device-info.md`) rather than a second
   * `statfs()`-walking implementation — `diskPath` should be
   * `app.getPath('userData')` or wherever the host app roots `local-ai`'s
   * downloads, `root` itself is unused by `freeSpaceBytes()`.
   */
  private readonly fs = new NodeFsAdapter('');

  constructor(private readonly diskPath: string) {}

  async getSnapshot(): Promise<DeviceSnapshot | null> {
    const totalBytes = os.totalmem();
    const freeBytes = getAvailableSystemBytes(totalBytes);
    return {
      totalRamGb: totalBytes / 1e9,
      freeRamGb: freeBytes / 1e9,
      freeDiskBytes: await this.fs.freeSpaceBytes(this.diskPath),
      thermal: 'unknown',
      lowPowerMode: undefined,
    };
  }
}
