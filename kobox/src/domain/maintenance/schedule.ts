import { CronSchedule } from './CronSchedule.js';

export interface ScheduledJob {
  readonly schedule: CronSchedule;
  readonly command: string;
}

const SUBCOMMAND_PATTERN = /^[a-z0-9-]+$/;

function entry(schedule: string, command: string): ScheduledJob {
  if (!SUBCOMMAND_PATTERN.test(command)) {
    throw new Error(`unsafe scheduler subcommand ${JSON.stringify(command)}`);
  }
  return { schedule: CronSchedule.parse(schedule), command };
}

// Functional parity with the legacy 26-line root cron (PROD-INSPECTION §2).
// Every entry ENQUEUES a typed job (kobox <subcommand>); the root worker
// stays the only privileged executor. Entries the legacy needed but KoBox
// does not: per-user rtorrent status + dnscrypt check (systemd Restart=),
// PeerGuardian (retired for ipset), LetsEncrypt renew (certbot.timer),
// GitHubRepoUpdate/UpgradeMe (operator-run `kobox upgrade` — §5.6),
// PaymentReminder (billing out of v1), jobs-check watchdog (systemd).
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  entry('*/5 * * * *', 'resolve-dyndns'),
  entry('*/5 * * * *', 'send-mails'),
  entry('*/5 * * * *', 'evaluate-fair-use'),
  entry('0 */6 * * *', 'update-blocklists'),
  entry('10 0 * * *', 'renew-tracker-certs'),
  entry('30 5 * * *', 'run-backup'),
  // advance in-flight debrid downloads (aria2 status -> place / fail)
  entry('*/2 * * * *', 'poll-debrid-downloads'),
  // files also appear and vanish over SFTP, outside any KoBox event
  entry('*/15 * * * *', 'index-media'),
];
