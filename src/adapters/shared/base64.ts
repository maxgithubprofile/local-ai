const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * From-scratch base64 codec (not `atob`/`btoa`) — every Capacitor adapter
 * that crosses the JS↔native bridge with binary data needs this (the
 * bridge only carries JSON-safe types), and this file is compiled under a
 * DOM-less `lib` (`tsconfig.json` only has `ES2022`) even though it always
 * *runs* in a WebView that does have those globals; avoiding the DOM lib
 * dependency keeps `tsc --noEmit` clean without environment-specific type
 * overrides. Shared here (not duplicated per-adapter) because it's a real
 * self-contained utility, not a port-shaped dependency — unlike the
 * `DeviceInfoPlugin` interface duplication in `capacitor-fs.adapter.ts`
 * (that one is duplicated *specifically* to keep two unrelated adapters
 * decoupled from each other; this is the opposite case, one utility with
 * no adapter-specific meaning).
 */
export function bytesToBase64(bytes: Uint8Array): string {
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

export function base64ToBytes(base64: string): Uint8Array {
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
