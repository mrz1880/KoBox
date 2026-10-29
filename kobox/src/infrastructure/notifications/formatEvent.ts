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

// Where and when it happened, for a message read hours later on a phone: which
// box, the page to open, and the time in UTC ('YYYY-MM-DD HH:MM:SS').
export interface NotificationContext {
  readonly box: string;
  readonly portalUrl: string;
  readonly at: string;
}

interface Notice {
  readonly title: string;
  // what happened and what it changed, one fact per line
  readonly facts: readonly string[];
  // what an admin may want to do about it, when anything
  readonly todo?: string;
  // the portal page that shows it, from the portal root
  readonly page: string;
  readonly priority: 'default' | 'high';
}

function mbit(bps: number): string {
  return `${String(Math.round(bps / 1_000_000))} Mbit/s`;
}

function member(username: string): string {
  return `/admin/users/${username}`;
}

// One message per event type, and no default: a new event that arrives here
// without its own words fails to compile instead of mailing its bare name.
function noticeOf(event: AnyDomainEvent): Notice {
  switch (event.type) {
    case 'UserCreated':
      return {
        title: `New member: ${event.username}`,
        facts: [
          `An account was created for ${event.username}: system account, rTorrent instance, home with its quota, and a VPN profile.`,
          'An invited member chooses their password through the link they were mailed; until then nobody can sign in as them.',
        ],
        page: member(event.username),
        priority: 'default',
      };
    case 'UserDeleted':
      return {
        title: `Member deleted: ${event.username}`,
        facts: [
          `The account of ${event.username} is gone, with their home and every file in it.`,
          'Also removed: their rTorrent instance, their VPN certificate (revoked), their Samba and Nextcloud logins and their password links.',
        ],
        page: '/admin/users',
        priority: 'default',
      };
    case 'PasswordChanged':
      return {
        title: `Password changed: ${event.username}`,
        facts: [
          `The password of ${event.username} changed; it applies to the portal, SFTP, Samba and Nextcloud.`,
          'Their open portal sessions were signed out and their app token revoked: programs using it (Sonarr, Radarr) need a new one.',
        ],
        todo: 'If neither they nor an admin did this, suspend the account from their page.',
        page: member(event.username),
        priority: 'default',
      };
    case 'PasswordResetRequested':
      return {
        title: `New password asked: ${event.username}`,
        facts: [
          `Someone asked for a new password for ${event.username} from the sign-in page; a link went to the address on their account.`,
          'Their current password keeps working until they choose a new one through that link.',
        ],
        todo: 'If they did not ask, nothing happens unless the link is used: suspend the account from their page if their mailbox may be in other hands.',
        page: member(event.username),
        priority: 'default',
      };
    case 'UserSuspended':
      return {
        title: `Member suspended: ${event.username}`,
        facts: [
          `${event.username} can no longer sign in anywhere: the account is locked, their sessions were ended and SFTP access closed.`,
          'Their rTorrent instance is stopped. Nothing was deleted.',
        ],
        todo: 'Resume them from their page when the reason is settled.',
        page: member(event.username),
        priority: 'default',
      };
    case 'UserResumed':
      return {
        title: `Member resumed: ${event.username}`,
        facts: [
          `${event.username} has full access again: account unlocked, SFTP open, rTorrent running.`,
        ],
        page: member(event.username),
        priority: 'default',
      };
    case 'TrackerDiscovered':
      return {
        title: `New tracker: ${event.host}`,
        facts: [
          `A torrent announced to ${event.host}, which this box did not know yet.`,
          'It is now registered and its certificate will be checked.',
        ],
        page: '/admin/trackers',
        priority: 'default',
      };
    case 'TrackerDied':
      return {
        title: `Tracker marked dead: ${event.host}`,
        facts: [
          `${event.host} is marked dead: it left the whitelist and its stored certificate was dropped.`,
          'Torrents that announce only to it no longer reach their peers through it.',
        ],
        todo: 'If it is back, it is picked up again the next time a torrent announces to it.',
        page: '/admin/trackers',
        priority: 'default',
      };
    case 'TrackerCertRenewed':
      return {
        title: `Tracker certificate renewed: ${event.host}`,
        facts: [`The certificate of ${event.host} was renewed; it is valid until ${event.expiresOn}.`],
        page: '/admin/trackers',
        priority: 'default',
      };
    case 'BlocklistUpdateFailed':
      return {
        title: `Blocklist update failed: ${event.author}/${event.name}`,
        facts: [
          `The update of the ${event.author}/${event.name} blocklist failed.`,
          'Its last good ranges stay in force, so nothing is let through meanwhile.',
        ],
        todo: 'Check the subscription on the blocklists page; it is retried on the next scheduled run.',
        page: '/admin/blocklists',
        priority: 'default',
      };
    case 'FairUseBreached':
      return {
        title: `Fair-use breach by ${event.username}`,
        facts: [
          `${event.username} sustained ${mbit(event.observedBps)} of egress, above the ${mbit(event.limitBps)} limit.`,
          'If it persists, their egress is throttled automatically; suspension stays a manual decision.',
        ],
        page: '/admin/fair-use',
        priority: 'high',
      };
    case 'AbnormalAuthRate':
      return {
        title: `Abnormal SSH sign-in rate for ${event.username}`,
        facts: [
          `${event.username} logged ${String(Math.round(event.perHour))} accepted public-key sign-ins in an hour (limit ${String(event.limitPerHour)}).`,
          'A leaked key or a runaway script both look like this.',
        ],
        todo: 'Check their SSH key and, if in doubt, remove it from their page.',
        page: member(event.username),
        priority: 'high',
      };
    case 'ServiceUnhealthy':
      return {
        title: `Service unhealthy for ${event.username}`,
        facts: [event.detail],
        todo: 'Restart it from the health page or the member page; the service log is there too.',
        page: '/admin/health',
        priority: 'high',
      };
    case 'UserThrottled':
      return {
        title: `${event.username} auto-throttled`,
        facts: [
          `The breach by ${event.username} persisted: their egress is now shaped to ${mbit(event.rateBps)}.`,
          'It is lifted automatically once they are back within fair use. Suspension stays manual.',
        ],
        page: '/admin/fair-use',
        priority: 'high',
      };
    case 'FairUseRecovered':
      return {
        title: `${event.username} back within fair use`,
        facts: [`The breach by ${event.username} ended; the throttle was lifted if one was active.`],
        page: '/admin/fair-use',
        priority: 'default',
      };
    case 'DynDnsAddressChanged':
      return {
        title: `Dynamic address updated for ${event.username}`,
        facts: [
          `${event.host} now points to ${event.newIp} (was ${event.oldIp ?? 'unknown'}).`,
          'The whitelist, the firewall and fail2ban were refreshed for the new address.',
        ],
        page: '/admin/addresses',
        priority: 'default',
      };
    case 'FirewallApplied':
      return event.outcome === 'rolled-back'
        ? {
            title: 'Firewall change rolled back',
            facts: [
              'The new ruleset broke the SSH lifeline probe, so the previous rules were restored.',
              'The box is reachable as before; the change that caused it is not in force.',
            ],
            todo: 'Look at what changed (an address, a port) before applying it again.',
            page: '/admin/health',
            priority: 'high',
          }
        : {
            title: 'Firewall applied',
            facts: ['The declarative ruleset was applied, and the SSH lifeline answered.'],
            page: '/admin/health',
            priority: 'default',
          };
  }
}

export function formatEvent(event: AnyDomainEvent, context: NotificationContext): FormattedEvent {
  const notice = noticeOf(event);
  const body = [
    ...notice.facts,
    ...(notice.todo === undefined ? [] : ['', `What to do: ${notice.todo}`]),
    '',
    `Open: ${context.portalUrl}${notice.page}`,
    `When: ${context.at} UTC`,
    `Box: ${context.box}`,
  ].join('\n');
  return { title: `[${context.box}] ${notice.title}`, body, priority: notice.priority };
}
