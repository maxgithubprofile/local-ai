import { sha256 } from '@noble/hashes/sha2.js';
import type { HashPort, IncrementalHasher } from '../../core/ports/hash.port.js';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * `@noble/hashes/sha2`'s incremental hasher as `IncrementalHasher` — a
 * pure-JS (no native bindings, no `node:crypto`) SHA-256 with a genuine
 * `.create().update(chunk)...digest()` streaming API (TZ §7.4 names this
 * exact library as the reference approach). Chosen over the platform's
 * *actual* Web Crypto API (`globalThis.crypto.subtle.digest()`) — despite
 * this file/class being named `WebCrypto*` for historical continuity —
 * because `SubtleCrypto` has no incremental digest primitive at all (only
 * a one-shot `digest(fullBuffer)`), which would force buffering an entire
 * GB-scale GGUF file in memory to satisfy `IncrementalHasher`'s streaming
 * contract. `@noble/hashes` needs no native addon and no Node-specific
 * API, so — unlike an earlier revision of this file that used
 * `node:crypto`'s classic `Hash` class — it genuinely runs unmodified in
 * both Node (this repo's tests) and a Capacitor WebView (production),
 * which is the whole reason TZ §3.1 expects one shared implementation
 * here instead of a dedicated Capacitor adapter.
 */
class NobleIncrementalHasher implements IncrementalHasher {
  private readonly hasher = sha256.create();

  update(chunk: Uint8Array): void {
    this.hasher.update(chunk);
  }

  digestHex(): string {
    return toHex(this.hasher.digest());
  }
}

/**
 * `HashPort` implementation shared by every platform (TZ §3.1/§7.4) — see
 * `NobleIncrementalHasher` above for why `@noble/hashes` backs it.
 */
export class WebCryptoHashAdapter implements HashPort {
  sha256(data: Uint8Array): string {
    return toHex(sha256(data));
  }

  createSha256(): IncrementalHasher {
    return new NobleIncrementalHasher();
  }
}
