import { Filesystem, Directory } from '@capacitor/filesystem';
import type { FileSystemPort } from '../../core/ports/filesystem.port.js';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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
}
