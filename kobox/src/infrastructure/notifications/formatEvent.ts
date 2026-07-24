import type { SecurityEvent } from '../../domain/security/events.js';
import type { TrackerEvent } from '../../domain/tracker/events.js';
import type { UserEvent } from '../../domain/user/events.js';

export type AnyDomainEvent = UserEvent | TrackerEvent | SecurityEvent;

export interface FormattedEvent {
  readonly title: string;
  readonly body: string;
  readonly priority: 'default' | 'high';
}

export interface NotificationChannel {
  send(message: FormattedEvent): Promise<void>;
}

function mbit(bps: number): string {
  return `${String(Math.round(bps / 1_000_000))} Mbit/s`;
}

// One human-readable rendering per event type; incidents that demand a human
// eye (the fair-use ladder, dead services) ride at high priority.
export function formatEvent(event: AnyDomainEvent): FormattedEvent {
  switch (event.type) {
    case 'FairUseBreached':
      return {
        title: `KoBox: fair-use breach by ${event.username}`,
        body: `${event.username} sustained ${mbit(event.observedBps)} egress (limit ${mbit(event.limitBps)}).`,
        priority: 'high',
      };
    case 'AbnormalAuthRate':
      return {
        title: `KoBox: abnormal SSH auth rate for ${event.username}`,
        body: `${event.username} logged ${String(Math.round(event.perHour))} accepted publickey logins/hour (limit ${String(event.limitPerHour)}).`,
        priority: 'high',
      };
    case 'ServiceUnhealthy':
      return {
        title: `KoBox: service unhealthy for ${event.username}`,
        body: event.detail,
        priority: 'high',
      };
    case 'UserThrottled':
      return {
        title: `KoBox: ${event.username} auto-throttled`,
        body: `Persisting breach — egress shaped to ${mbit(event.rateBps)}. Suspension stays manual.`,
        priority: 'high',
      };
    case 'FairUseRecovered':
      return {
        title: `KoBox: ${event.username} back within fair use`,
        body: 'Breach ended; throttle lifted if one was active.',
        priority: 'default',
      };
    case 'DynDnsAddressChanged':
      return {
        title: `KoBox: dyndns update for ${event.username}`,
        body: `${event.host}: ${event.oldIp ?? '(none)'} -> ${event.newIp}. Whitelist, firewall and fail2ban refreshed.`,
        priority: 'default',
      };
    case 'FirewallApplied':
      return {
        title: `KoBox: firewall ${event.outcome}`,
        body:
          event.outcome === 'rolled-back'
            ? 'New ruleset broke the SSH lifeline probe — previous rules restored.'
            : 'Declarative ruleset applied.',
        priority: event.outcome === 'rolled-back' ? 'high' : 'default',
      };
    case 'BlocklistUpdateFailed':
      return {
        title: `KoBox: blocklist update failed (${event.author}/${event.name})`,
        body: 'Last good ranges kept; check the subscription.',
        priority: 'default',
      };
    default: {
      const subject = 'username' in event ? event.username : event.host;
      return { title: `KoBox: ${event.type} ${subject}`, body: event.type, priority: 'default' };
    }
  }
}
