import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { FileSystemPort } from '../../core/ports/filesystem.port.js';
import { bytesToBase64, base64ToBytes } from '../shared/base64.js';

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

/**
 * Wraps `@capacitor/filesystem` (TZ §4.3). Every method operates within a
 * single fixed `Directory` (default `Directory.Data` — "deleted when the
 * app is uninstalled", the right lifetime for downloaded model/embedding
 * artifacts and session-cache files, per the plugin's own docs quoted in
 * `docs/adr` research) — `resolvePath()` returns a plain `/`-joined
 * relative path *within* that directory, which every other method here
 * passes straight through as the plugin's own `path` option.
 *
 * The plugin's `readFile`/`writeFile`/`appendFile` exchange binary data as
 * base64 strings (no raw byte transport across the JS bridge) — see
 * `../shared/base64.ts` for the codec and why it's from-scratch rather than
 * `atob`/`btoa`.
 */
export class CapacitorFsAdapter implements FileSystemPort {
  constructor(private readonly directory: Directory = Directory.Data) {}

  resolvePath(...segments: string[]): string {
    return segments.join('/');
  }

  /**
   * `Filesystem.getUri()` is the plugin's own documented mechanism for
   * turning a `{path, directory}` pair into a real filesystem URI — used
   * wherever a path needs to leave this port's own relative+directory
   * convention (see `FileSystemPort.toAbsolutePath()`'s doc comment).
   *
   * The returned `uri` is percent-encoded (it's a URI, not a raw path) —
   * `decodeURIComponent()` here is required, not cosmetic. Confirmed live on
   * Android, 2026-08-20: a session filename containing `:` (the model
   * fingerprint's own separator, e.g. `qwen3-4b:1`) came back from
   * `getUri()` as `...qwen3-4b%3A1.bin`; every caller of this method hands
   * the result straight to the native `LlmRuntimePort` binding, which treats
   * it as a literal filesystem path, not a URI — so `saveSession()` silently
   * wrote to a *different* filename than `exists()`/`stat()` (which resolve
   * through the plugin's own already-decoded path handling) would ever find
   * again. Session persistence was effectively permanently broken until
   * this was fixed — see `docs/decisions.md`.
   */
  async toAbsolutePath(path: string): Promise<string> {
    const { uri } = await Filesystem.getUri({ path, directory: this.directory });
    const stripped = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
    return decodeURIComponent(stripped);
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

  async appendFile(path: string, data: Uint8Array): Promise<void> {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent) await this.mkdir(parent, { recursive: true }).catch(() => undefined);
    await Filesystem.appendFile({ path, directory: this.directory, data: bytesToBase64(data) });
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
