import type { RenderedFile } from '../shared/files.js';
import { managedHeader } from '../shared/managedHeader.js';
import { SCHEDULED_JOBS } from './schedule.js';

export interface CronRenderSettings {
  readonly koboxBin: string;
}

// The whole legacy 26-line root cron + jobs-check watchdog collapses into
// this one declarative file: schedules enqueue typed jobs, systemd
// supervises cron and the worker, a missed tick converges at the next one.
// The command every cron entry invokes. Nothing installed it: the scheduler
// rendered entries calling /usr/local/bin/kobox and that file did not exist, so
// on a real box every scheduled job silently did nothing. No mail flush, no
// blocklist update, no backup, no certificate renewal. The E2E missed it by
// setting KOBOX_BIN to a command it built itself, which proved the wiring while
// supplying the one piece production lacked.
//
// It resolves through the `current` symlink, so an upgrade carries it along and
// no reinstall is needed.
export function renderKoboxCommand(settings: {
  readonly nodeBin: string;
  readonly currentLink: string;
  readonly koboxBin: string;
}): RenderedFile {
  return {
    path: settings.koboxBin,
    content: [
      '#!/bin/sh',
      managedHeader('#', 'file'),
      `exec ${settings.nodeBin} ${settings.currentLink}/dist/interfaces/cli/main.js "$@"`,
      '',
    ].join('\n'),
    mode: '0755',
    owner: 'root',
    group: 'root',
  };
}

// Cron mails root whatever a job prints, and every run prints a line: the
// output goes to the journal instead, stderr as a warning so a job that went
// wrong stands out there.
const TO_THE_JOURNAL = 'systemd-cat -t kobox-cron --stderr-priority=warning';

export function renderCronFile(settings: CronRenderSettings): RenderedFile {
  const lines = [
    '# kobox scheduler - managed by KoBox, do not edit',
    '# Each entry runs the kobox CLI, which mostly enqueues a typed job for the',
    '# kobox-worker service; its output goes to the journal (tag kobox-cron).',
    'SHELL=/bin/sh',
    'PATH=/usr/sbin:/usr/bin:/sbin:/bin',
    '',
    ...SCHEDULED_JOBS.map(
      (job) => `${job.schedule.value} root ${TO_THE_JOURNAL} ${settings.koboxBin} ${job.command}`,
    ),
    '',
  ];
  return {
    path: '/etc/cron.d/kobox',
    content: lines.join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}
