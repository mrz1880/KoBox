import { connect, type Socket } from 'node:net';
import { hostname } from 'node:os';
import type {
  MailDelivery,
  MailTransportPort,
} from '../../application/maintenance/MailTransportPort.js';

// Postfix listens on the loopback only; this is where every mail is handed.
const LOOPBACK = '127.0.0.1';
const SMTP_PORT = 25;
// The relay is local and answers in milliseconds: a few seconds without an
// answer means it is not going to, and the mail is better off in the outbox.
const ANSWER_TIMEOUT_MS = 5_000;
// The sender the box used with sendmail as root; Postfix qualifies it with its
// own domain, as it did then.
const ENVELOPE_SENDER = 'root';

export interface SmtpLoopbackOptions {
  readonly port?: number;
}

class SmtpRefusedError extends Error {}

// Hands a mail to the local Postfix over SMTP, which needs no privilege:
// sendmail went through postdrop, a setgid program the sandboxed portal may not
// run. Resolves once Postfix said it queued the mail; throws otherwise, which
// is what sends the mail to the outbox and its retry ladder.
export class SmtpLoopbackTransport implements MailTransportPort {
  private readonly port: number;

  constructor(options: SmtpLoopbackOptions = {}) {
    this.port = options.port ?? SMTP_PORT;
  }

  async deliver(mail: MailDelivery): Promise<void> {
    const session = await SmtpSession.open(LOOPBACK, this.port);
    try {
      await session.expect(220);
      await session.command(`EHLO ${hostname()}`, 250);
      await session.command(`MAIL FROM:<${ENVELOPE_SENDER}> BODY=8BITMIME`, 250);
      await session.command(`RCPT TO:<${addressOnly(mail.recipient)}>`, 250, 251);
      await session.command('DATA', 354);
      await session.command(`${messageOf(mail)}\r\n.`, 250);
      // queued from here on: a QUIT that goes wrong changes nothing
      await session.command('QUIT', 221).catch(() => undefined);
    } finally {
      session.close();
    }
  }
}

// header values are one line by definition: stripping CR/LF closes the
// header-injection class even if a caller forwards user text
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function addressOnly(value: string): string {
  return oneLine(value).replace(/[<>\s]/g, '');
}

function messageOf(mail: MailDelivery): string {
  const lines = [
    `To: ${oneLine(mail.recipient)}`,
    `Subject: ${oneLine(mail.subject)}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    ...mail.body.split(/\r?\n/),
  ];
  // a line made of a single dot ends the message: every leading dot is doubled
  return lines.map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

// One SMTP conversation: send a line, read the full (possibly multi-line)
// answer, check its code.
class SmtpSession {
  private buffer = '';
  private waiting: ((reply: { code: number; text: string } | Error) => void) | undefined;
  private failure: Error | undefined;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(ANSWER_TIMEOUT_MS, () => {
      this.fail(new Error('the local mail relay did not answer in time'));
    });
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.deliverReply();
    });
    socket.on('error', (error) => {
      this.fail(error);
    });
    socket.on('close', () => {
      this.fail(new Error('the local mail relay closed the connection'));
    });
  }

  static open(host: string, port: number): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      socket.once('connect', () => {
        socket.removeListener('error', reject);
        resolve(new SmtpSession(socket));
      });
      socket.once('error', reject);
    });
  }

  async command(line: string, ...accepted: number[]): Promise<void> {
    this.socket.write(`${line}\r\n`);
    await this.expect(...accepted);
  }

  async expect(...accepted: number[]): Promise<void> {
    const reply = await this.nextReply();
    if (!accepted.includes(reply.code)) {
      throw new SmtpRefusedError(`the local mail relay answered ${reply.text}`);
    }
  }

  close(): void {
    this.socket.destroy();
  }

  private nextReply(): Promise<{ code: number; text: string }> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.waiting = (reply) => {
        if (reply instanceof Error) {
          reject(reply);
        } else {
          resolve(reply);
        }
      };
      this.deliverReply();
    });
  }

  // A reply is complete at a line whose fourth character is a space ("250 Ok");
  // "250-..." lines continue it.
  private deliverReply(): void {
    if (this.waiting === undefined) {
      return;
    }
    const lines = this.buffer.split('\r\n');
    const last = lines.findIndex((line) => /^\d{3} /.test(line) || /^\d{3}$/.test(line));
    if (last === -1) {
      return;
    }
    const replyLines = lines.slice(0, last + 1);
    this.buffer = lines.slice(last + 1).join('\r\n');
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting({ code: Number(replyLines[last]?.slice(0, 3)), text: replyLines.join(' ') });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.(error);
  }
}
