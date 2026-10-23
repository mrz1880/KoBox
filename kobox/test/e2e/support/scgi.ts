import { connect } from 'node:net';

// Minimal XML-RPC-over-SCGI client for E2E assertions: the strongest proof of
// what rtorrent did is rtorrent's own answer, not a log line. String params
// only, which covers every getter and info-hash call the suites make.
export function scgiCall(
  port: number,
  method: string,
  params: readonly string[] = [],
  timeoutMs = 5_000,
): Promise<string> {
  const xmlParams = params
    .map((param) => `<param><value><string>${param}</string></value></param>`)
    .join('');
  const body =
    '<?xml version="1.0"?><methodCall>' +
    `<methodName>${method}</methodName><params>${xmlParams}</params>` +
    '</methodCall>';
  const payload = Buffer.from(body, 'utf8');
  // SCGI headers are NUL-separated, never spaces
  const headers = Buffer.from(
    `CONTENT_LENGTH\u0000${String(payload.length)}\u0000SCGI\u00001\u0000`,
    'utf8',
  );
  const frame = Buffer.concat([
    Buffer.from(`${String(headers.length)}:`),
    headers,
    Buffer.from(','),
    payload,
  ]);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error(`SCGI timeout calling ${method}`));
    });
    socket.on('connect', () => socket.write(frame));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}
