import { describe, expect, it } from 'vitest';
import { callsForAnAdmin } from '../../../../src/domain/shared/attention.js';

// The box mailed about ten messages a day, nearly all about something that
// went fine or mended itself: the admin stopped reading them, the urgent ones
// included. Only what an admin has to act on interrupts them now; the rest is
// in the portal and the worker's log.
describe('what calls for an admin', () => {
  it.each(['ServiceUnhealthy', 'BlocklistUpdateFailed', 'TrackerDied', 'AbnormalAuthRate'])(
    'should_interrupt_the_admin_for_%s',
    (type) => {
      expect(callsForAnAdmin({ type })).toBe(true);
    },
  );

  // a ruleset that did not hold was rolled back: the box runs on the old one
  it('should_interrupt_the_admin_for_a_firewall_rolled_back', () => {
    expect(callsForAnAdmin({ type: 'FirewallApplied', outcome: 'rolled-back' })).toBe(true);
  });

  it('should_leave_a_firewall_applied_as_planned_to_the_portal', () => {
    expect(callsForAnAdmin({ type: 'FirewallApplied', outcome: 'applied' })).toBe(false);
  });

  it.each([
    'UserCreated',
    'UserDeleted',
    'UserSuspended',
    'UserResumed',
    'PasswordChanged',
    'PasswordResetRequested',
    'TrackerDiscovered',
    'TrackerCertRenewed',
    'DynDnsAddressChanged',
    'FairUseBreached',
    'UserThrottled',
    'FairUseRecovered',
  ])('should_leave_%s_to_the_portal', (type) => {
    expect(callsForAnAdmin({ type })).toBe(false);
  });
});
