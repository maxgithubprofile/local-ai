import type { HashPort, IncrementalHasher } from '../../core/ports/hash.port.js';

/**
 * Not implemented — Phase 2 (ROADMAP.md). `HashPort` over the standard Web
 * Crypto API (available in Node via `node:crypto`'s `webcrypto`, and in any
 * WebView/browser) — TZ §3.1 groups this with the Node-testing adapters,
 * but being platform-generic it likely doubles as the production
 * implementation too (no dedicated Capacitor adapter is listed for hashing
 * in TZ §3, §4) unless the Phase 0 spike on streaming SHA-256 performance
 * (TZ §7.4, §17) finds a reason to swap in a native implementation.
 */
export class WebCryptoHashAdapter implements HashPort {
  sha256(_data: Uint8Array): string {
    throw new Error('not implemented — see TZ §7.4, ROADMAP Phase 2');
  }

  createSha256(): IncrementalHasher {
    throw new Error('not implemented — see TZ §7.4, ROADMAP Phase 2');
  }
}
