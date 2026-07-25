import type { RenderedFile } from '../shared/files.js';
import { SCHEDULED_JOBS } from './schedule.js';

export interface CronRenderSettings {
  readonly koboxBin: string;
}

// The whole legacy 26-line root cron + jobs-check watchdog collapses into
// this one declarative file: schedules enqueue typed jobs, systemd
// supervises cron and the worker, a missed tick converges at the next one.
export function renderCronFile(settings: CronRenderSettings): RenderedFile {
  const lines = [
    '# kobox scheduler - managed by KoBox, do not edit',
    '# Every entry enqueues a typed job; the kobox-worker service executes.',
    'SHELL=/bin/sh',
    'PATH=/usr/sbin:/usr/bin:/sbin:/bin',
    '',
    ...SCHEDULED_JOBS.map(
      (job) => `${job.schedule.value} root ${settings.koboxBin} ${job.command}`,
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
