import { createHash } from 'node:crypto';
import type { HashPort, IncrementalHasher } from '../../core/ports/hash.port.js';

/**
 * `node:crypto`'s `Hash` object as `IncrementalHasher` — it's already a
 * true streaming digest (`.update(chunk)` per chunk, `.digest()` once at
 * the end, no full-file buffering), which is exactly the shape TZ §7.4
 * needs for GB-scale GGUF files. (Named `WebCrypto*` for continuity with
 * the file/class name every other adapter/port doc already references —
 * `node:crypto`'s classic API was chosen over `webcrypto.subtle.digest()`
 * specifically because the latter is Promise-based and has no incremental
 * primitive, which would force buffering the whole file to satisfy
 * `IncrementalHasher`'s synchronous `update()`/`digestHex()` shape. Same
 * SHA-256 algorithm and output either way.)
 */
class NodeCryptoIncrementalHasher implements IncrementalHasher {
  private readonly hash = createHash('sha256');

  update(chunk: Uint8Array): void {
    this.hash.update(chunk);
  }

  digestHex(): string {
    return this.hash.digest('hex');
  }
}

/**
 * `HashPort` implementation used both in Node tests and — pending no
 * reason to special-case a native implementation (Phase 0 spike,
 * `docs/adr/0006-streaming-sha256-timing.md`) — as the production
 * implementation too (TZ §3.1/§7.4). See {@link NodeCryptoIncrementalHasher}
 * for why `node:crypto`'s classic `Hash` API backs it rather than
 * `webcrypto.subtle.digest()`.
 */
export class WebCryptoHashAdapter implements HashPort {
  sha256(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }

  createSha256(): IncrementalHasher {
    return new NodeCryptoIncrementalHasher();
  }
}
