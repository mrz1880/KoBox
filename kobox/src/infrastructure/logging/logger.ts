import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.KOBOX_LOG_LEVEL ?? 'info',
    // belt-and-braces: secrets are VOs that redact themselves, but a raw
    // field slipping through common key names must not reach the log stream
    redact: ['password', 'passwordHash', '*.password', '*.passwordHash'],
  });
}
