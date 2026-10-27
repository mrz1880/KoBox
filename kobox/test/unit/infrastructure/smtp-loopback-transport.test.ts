import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SmtpLoopbackTransport } from '../../../src/infrastructure/notifications/SmtpLoopbackTransport.js';

// A relay that answers like Postfix and records what it was told. `refuseAt`
// makes it answer 554 to that command instead.
function relay(refuseAt?: string): Promise<{ server: Server; port: number; said: string[] }> {
  const said: string[] = [];
  const server = createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.write('220 relay ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end = buffer.indexOf('\r\n');
      while (end !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        said.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 2.0.0 Ok: queued\r\n');
          }
        } else if (refuseAt !== undefined && line.startsWith(refuseAt)) {
          socket.write('554 5.7.1 refused\r\n');
        } else if (line.startsWith('EHLO')) {
          socket.write('250-relay\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('250 Ok\r\n');
        }
        end = buffer.indexOf('\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, said });
    });
  });
}

const MAIL = {
  recipient: 'alice@example.org',
  subject: 'Your link\r\nBcc: someone@example.net',
  body: 'Hello\n.hidden line\nBye',
};

let open: Server | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

describe('SmtpLoopbackTransport', () => {
  it('should_hand_the_mail_to_the_relay_in_one_smtp_session', async () => {
    const { server, port, said } = await relay();
    open = server;

    await new SmtpLoopbackTransport({ port }).deliver(MAIL);

    expect(said.slice(0, 4)).toEqual([
      expect.stringMatching(/^EHLO /),
      'MAIL FROM:<root> BODY=8BITMIME',
      'RCPT TO:<alice@example.org>',
      'DATA',
    ]);
    // one line per header value, so the subject cannot smuggle in a Bcc
    expect(said).toContain('Subject: Your link Bcc: someone@example.net');
    expect(said).not.toContain('Bcc: someone@example.net');
    // a body line starting with a dot is doubled, or the relay reads its end
    expect(said).toContain('..hidden line');
    expect(said.slice(-2)).toEqual(['.', 'QUIT']);
  });

  it('should_fail_when_the_relay_refuses_the_recipient', async () => {
    const { server, port } = await relay('RCPT');
    open = server;

    await expect(new SmtpLoopbackTransport({ port }).deliver(MAIL)).rejects.toThrow(/554/);
  });

  it('should_fail_when_no_relay_listens', async () => {
    const { server, port } = await relay();
    server.close();

    await expect(new SmtpLoopbackTransport({ port }).deliver(MAIL)).rejects.toThrow();
  });
});
