/**
 * Not implemented — Phase 2 (ROADMAP.md). Streams a file through
 * `HashPort.createSha256()` in chunks (TZ §7.4) rather than reading it fully
 * into memory — the artifacts here are GB-scale GGUF files.
 */
export function verifyChecksum(): Promise<never> {
  throw new Error('not implemented — see TZ §7.4, ROADMAP Phase 2');
}
