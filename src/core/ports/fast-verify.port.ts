/**
 * Optional native-speed checksum capability — TZ §7.4's `checksum.ts`
 * (streams the file through `FileSystemPort.readChunks()` +
 * `HashPort.createSha256()`, entirely portable, works identically in
 * Node and any Capacitor build) turned out to be catastrophically slow
 * for GB-scale files specifically on Capacitor/Android: each `readChunks()`
 * iteration is a full JS↔native bridge round-trip through
 * `@capacitor/filesystem`'s `readFile()` (base64 encode on the native
 * side, decode in JS) — confirmed live, 2026-08-19, at roughly 1% per
 * 68 seconds for a 2.3GB model (~1.9 HOURS to verify one download).
 *
 * `FastVerifyPort` is a deliberately optional escape hatch: when a
 * platform adapter provides one (Capacitor/Android does, reading the file
 * with a plain `FileInputStream` + `java.security.MessageDigest`, no
 * bridge round-trips at all), `DownloadEngine` uses it instead of the
 * portable `readChunks()`+`HashPort` path. Omitting it (Node tests, any
 * platform without a native implementation yet) falls back to the
 * original streaming path — correctness never depends on this existing,
 * only speed does.
 */
export interface FastVerifyPort {
  /**
   * Computes `path`'s SHA-256 at native speed and compares it against
   * `expectedHex` (case-insensitive) — returns whether it matched.
   * @param onProgress Called with bytes hashed so far, as often as the
   *   implementation can cheaply manage — used for the same incremental
   *   `status: 'verifying'` UI progress `checksum.ts`'s own `onProgress`
   *   drives on the fallback path.
   */
  sha256File(path: string, expectedHex: string, onProgress?: (bytesHashed: number) => void): Promise<boolean>;
}
