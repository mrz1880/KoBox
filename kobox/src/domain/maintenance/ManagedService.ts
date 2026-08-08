import { DomainError } from '../shared/DomainError.js';

export class UnknownManagedServiceError extends DomainError {
  constructor(raw: string) {
    super(`unknown managed service ${JSON.stringify(raw)}`);
  }
}

// The units an admin may restart from the portal, as a CLOSED set. An open
// "restart any unit" control would be a root shell with a nicer form: it would
// let the portal reach sshd, or systemd itself.
//
// kobox-worker is deliberately ABSENT. The worker is what executes the job, so
// restarting it from one would kill the process mid-work and leave the job
// neither done nor failed. That one stays a shell operation.
const MANAGED_SERVICES = [
  'nginx',
  'kobox-portal',
  'kobox-aria2',
  'kobox-nanomon',
  'fail2ban',
] as const;

export type ManagedServiceValue = (typeof MANAGED_SERVICES)[number];

// Reading a unit's journal is safe where restarting it is not, so kobox-worker
// belongs here — its log is often exactly what an operator needs. Still a closed
// set: journalctl on an arbitrary unit would expose the whole host's logs.
const LOGGABLE_SERVICES = [...MANAGED_SERVICES, 'kobox-worker'] as const;

export type LoggableServiceValue = (typeof LOGGABLE_SERVICES)[number];

export class LoggableService {
  private constructor(readonly value: LoggableServiceValue) {}

  static parse(raw: string): LoggableService {
    const found = LOGGABLE_SERVICES.find((name) => name === raw);
    if (found === undefined) {
      throw new UnknownManagedServiceError(raw);
    }
    return new LoggableService(found);
  }

  static all(): readonly LoggableServiceValue[] {
    return LOGGABLE_SERVICES;
  }
}

export class ManagedService {
  private constructor(readonly value: ManagedServiceValue) {}

  static parse(raw: string): ManagedService {
    const found = MANAGED_SERVICES.find((name) => name === raw);
    if (found === undefined) {
      throw new UnknownManagedServiceError(raw);
    }
    return new ManagedService(found);
  }

  static all(): readonly ManagedServiceValue[] {
    return MANAGED_SERVICES;
  }
}
