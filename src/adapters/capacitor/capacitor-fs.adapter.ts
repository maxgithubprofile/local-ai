import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { FileSystemPort } from '../../core/ports/filesystem.port.js';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Minimal slice of `@capgo/capacitor-device-info`'s surface this file needs
 * (SEC.3) — `@capacitor/filesystem` itself exposes no free-space API.
 * Duplicated from `capgo-device-info.adapter.ts`'s own minimal interface
 * rather than imported from it: the two adapters implement different ports
 * and neither should depend on the other's module for an unrelated reason
 * (hexagonal boundary is about `core/**`, but keeping adapters independent
 * of each other avoids an accidental coupling here too).
 */
interface DeviceInfoPlugin {
  getInfo(): Promise<{ storage: { freeBytes?: number } }>;
}

/** Registration name confirmed in `docs/adr/0005-native-plugin-name-constants.md` — same plugin `capgo-device-info.adapter.ts` registers. */
const DeviceInfo = registerPlugin<DeviceInfoPlugin>('DeviceInfo');

/** No DOM lib (`atob`/`btoa`) is assumed available — this runs in a WebView, but the build itself targets plain ES2022. */
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
  }
  return result;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Wraps `@capacitor/filesystem` (TZ §4.3). Every method operates within a
 * single fixed `Directory` (default `Directory.Data` — "deleted when the
 * app is uninstalled", the right lifetime for downloaded model/embedding
 * artifacts and session-cache files, per the plugin's own docs quoted in
 * `docs/adr` research) — `resolvePath()` returns a plain `/`-joined
 * relative path *within* that directory, which every other method here
 * passes straight through as the plugin's own `path` option.
 *
 * The plugin's `readFile`/`writeFile` exchange binary data as base64
 * strings (no raw byte transport across the JS bridge) — `bytesToBase64`/
 * `base64ToBytes` above are a from-scratch codec rather than `atob`/`btoa`
 * because this file is compiled under a DOM-less `lib` (`tsconfig.json`
 * only has `ES2022`) even though it always *runs* in a WebView that does
 * have those globals; avoiding the DOM lib dependency keeps `tsc --noEmit`
 * clean without needing environment-specific type overrides.
 */
export class CapacitorFsAdapter implements FileSystemPort {
  constructor(private readonly directory: Directory = Directory.Data) {}

  resolvePath(...segments: string[]): string {
    return segments.join('/');
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path, directory: this.directory });
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await Filesystem.mkdir({ path, directory: this.directory, recursive: options?.recursive ?? false });
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent) await this.mkdir(parent, { recursive: true }).catch(() => undefined);
    const payload = typeof data === 'string' ? data : bytesToBase64(data);
    await Filesystem.writeFile({ path, directory: this.directory, data: payload, recursive: true });
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await Filesystem.readFile({ path, directory: this.directory });
    return typeof result.data === 'string' ? base64ToBytes(result.data) : new Uint8Array(await result.data.arrayBuffer());
  }

  async *readChunks(path: string, chunkSizeBytes: number): AsyncIterable<Uint8Array> {
    const info = await Filesystem.stat({ path, directory: this.directory });
    let offset = 0;
    while (offset < info.size) {
      const result = await Filesystem.readFile({
        path,
        directory: this.directory,
        offset,
        length: chunkSizeBytes,
      });
      const chunk =
        typeof result.data === 'string' ? base64ToBytes(result.data) : new Uint8Array(await result.data.arrayBuffer());
      if (chunk.length === 0) break;
      yield chunk;
      offset += chunk.length;
    }
  }

  async deleteFile(path: string): Promise<void> {
    await Filesystem.deleteFile({ path, directory: this.directory }).catch(() => undefined);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    try {
      const result = await Filesystem.readdir({ path: dirPath, directory: this.directory });
      return result.files.map((f) => f.name);
    } catch {
      return [];
    }
  }

  async stat(path: string): Promise<{ sizeBytes: number } | null> {
    try {
      const info = await Filesystem.stat({ path, directory: this.directory });
      return { sizeBytes: info.size };
    } catch {
      return null;
    }
  }

  /**
   * Reads `@capgo/capacitor-device-info`'s `storage.freeBytes` (SEC.3) —
   * `path` is unused (that plugin reports free space for the device's
   * storage volume as a whole, not per-directory), kept only to satisfy
   * `FileSystemPort`'s signature symmetrically with `NodeFsAdapter`. Soft
   * dependency, same pattern as `CapgoDeviceInfoAdapter.getSnapshot()`: if
   * the plugin isn't installed/available on this platform, resolves `0`
   * rather than throwing — `DownloadEngine` will then correctly refuse to
   * download (fail-closed) instead of silently skipping the check.
   * Untestable from this environment (no device), same residual-risk
   * pattern as every other Capacitor-adapter claim in this codebase.
   */
  async freeSpaceBytes(_path: string): Promise<number> {
    if (!Capacitor.isPluginAvailable('DeviceInfo')) return 0;
    const info = await DeviceInfo.getInfo();
    return info.storage.freeBytes ?? 0;
  }
}
