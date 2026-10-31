import type { SecurityEvent } from '../security/events.js';
import type { TrackerEvent } from '../tracker/events.js';

// What an admin has to act on: a service down, a blocklist that stopped
// updating, a tracker gone, sign-ins at a rate no person types, a firewall
// rolled back. Everything else
// went fine or mends itself (a firewall applied, a member who joined, a
// throttle that lifted): it stays in the portal and the worker's log rather
// than in the admin's mailbox, where it buried these.
const NEEDS_AN_ADMIN: ReadonlySet<string> = new Set<SecurityEvent['type'] | TrackerEvent['type']>([
  'ServiceUnhealthy',
  'BlocklistUpdateFailed',
  'TrackerDied',
  'AbnormalAuthRate',
]);

// Takes any event: one of a type not listed is simply not urgent. A firewall
// is urgent only when the new ruleset did not hold and was rolled back.
export function callsForAnAdmin(event: { readonly type: string; readonly outcome?: string }): boolean {
  if (event.type === 'FirewallApplied') {
    return event.outcome === 'rolled-back';
  }
  return NEEDS_AN_ADMIN.has(event.type);
}
