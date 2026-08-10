import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local HTTP server for exercising `DownloadTransportPort` implementations
 * against realistic failure modes — TZ §7.3: dropped connections, changed
 * `ETag`, missing `Accept-Ranges`. Serves one fixed byte buffer at `/file`
 * with controllable behavior, toggled between requests by the test.
 */
export function createMockDownloadServer(content: Buffer) {
  let dropAfterBytes: number | null = null;
  let etag = '"etag-1"';
  let acceptRanges = true;
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    requestCount += 1;
    const rangeHeader = req.headers.range;
    let start = 0;
    let status = 200;

    if (rangeHeader && acceptRanges) {
      const match = /bytes=(\d+)-/.exec(rangeHeader);
      if (match) {
        start = Number(match[1]);
        status = 206;
      }
    }

    const end = content.length - 1;
    const slice = content.subarray(start, end + 1);
    const headers: http.OutgoingHttpHeaders = {
      'content-length': slice.length,
      etag,
    };
    if (acceptRanges) headers['accept-ranges'] = 'bytes';
    if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${content.length}`;

    res.writeHead(status, headers);

    if (dropAfterBytes !== null && dropAfterBytes < slice.length) {
      const cut = dropAfterBytes;
      dropAfterBytes = null; // only drop once, so a retry succeeds
      res.write(slice.subarray(0, cut));
      res.destroy();
      return;
    }

    res.end(slice);
  });

  return {
    server,
    get requestCount() {
      return requestCount;
    },
    /** Drops the connection after `bytes` bytes of the *next* response (one-shot). */
    dropNextResponseAfter(bytes: number): void {
      dropAfterBytes = bytes;
    },
    setEtag(value: string): void {
      etag = value;
    },
    setAcceptRanges(value: boolean): void {
      acceptRanges = value;
    },
    async listen(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      return `http://127.0.0.1:${port}/file`;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
