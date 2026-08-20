/**
 * Bridges a callback-driven token producer (both `node-llama-cpp`'s
 * `onTextChunk` and `llama-cpp-pro`'s (formerly `llama-cpp-capacitor`)
 * `completion(params, callback)` push tokens via a callback, not an `AsyncIterable`) into the
 * `AsyncIterable<CompletionToken>` half of `CompletionStream` (TZ §10.0).
 * Shared between the Node and Capacitor LLM runtime adapters *and*
 * `LocalAiClient.sendMessage()` — pure logic, no platform dependency, so it
 * lives in `core/` rather than under either `adapters/**` (which `core/**`
 * cannot import from, hexagonal boundary) or being duplicated three times.
 */
export class AsyncTokenQueue<T> {
  private readonly buffer: T[] = [];
  private resolveNext: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value, done: false });
    } else {
      this.buffer.push(value);
    }
  }

  /** No more values will ever be pushed — pending/future `next()` calls resolve `done: true`. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise((resolve) => {
          this.resolveNext = resolve;
        });
      },
    };
  }
}
