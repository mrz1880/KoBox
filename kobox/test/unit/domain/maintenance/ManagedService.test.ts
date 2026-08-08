import { describe, expect, it } from 'vitest';
import {
  LoggableService,
  ManagedService,
  UnknownManagedServiceError,
} from '../../../../src/domain/maintenance/ManagedService.js';

describe('ManagedService', () => {
  it('should_accept_the_units_kobox_manages', () => {
    for (const name of ManagedService.all()) {
      expect(ManagedService.parse(name).value, name).toBe(name);
    }
  });

  it('should_refuse_any_other_unit', () => {
    // an open restart control would be a root shell behind a nicer form
    for (const bad of ['sshd', 'systemd', 'ssh', '', 'nginx; reboot', '../nginx']) {
      expect(() => ManagedService.parse(bad), bad).toThrow(UnknownManagedServiceError);
    }
  });

  it('should_never_offer_the_worker_itself', () => {
    // the worker carries out the restart: restarting it from a job would kill
    // the process mid-flight, leaving the job neither done nor failed
    expect(ManagedService.all()).not.toContain('kobox-worker');
    expect(() => ManagedService.parse('kobox-worker')).toThrow(UnknownManagedServiceError);
  });
});

describe('LoggableService', () => {
  it('should_accept_every_unit_kobox_manages', () => {
    for (const name of ManagedService.all()) {
      expect(LoggableService.parse(name).value, name).toBe(name);
    }
  });

  it('should_also_accept_the_worker_because_reading_is_not_restarting', () => {
    // the worker's own journal is often the one an operator needs, and tailing
    // it costs the worker nothing
    expect(LoggableService.parse('kobox-worker').value).toBe('kobox-worker');
  });

  it('should_refuse_any_other_unit', () => {
    // journalctl on an arbitrary unit would hand the whole host's logs to a
    // web page
    for (const bad of ['sshd', 'systemd', '', 'nginx sshd', '--user']) {
      expect(() => LoggableService.parse(bad), bad).toThrow(UnknownManagedServiceError);
    }
  });
});
