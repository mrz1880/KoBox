import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import type { Quota } from '../../../domain/user/Quota.js';
import { UsableSpace, type SpaceLimit } from '../../../domain/user/UsableSpace.js';
import type { DiskUsageSample, VolumeSample } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { formatBytes } from './bytes.js';
import { formatAgo, formatClock, nextRunAfter } from './moment.js';
import { scheduleOf } from '../../../domain/maintenance/schedule.js';
import { sentence, type Viewer } from './layout.js';

// the scheduled pass that measures every member's space
const SAMPLE_COMMAND = 'sample-disk-usage';

// A member's space as the last hourly pass left it: what they hold, what their
// allowance promises, and what they can still fill.
export interface MeasuredSpace {
  readonly allowance: Quota;
  readonly used: Quota;
  readonly usable: UsableSpace;
  readonly measuredAt: string;
}

// Nothing is guessed: without both the member's reading and the volume's,
// there is no usable space to show.
export function measuredSpace(
  user: SeedboxUser,
  usage: DiskUsageSample | undefined,
  volume: VolumeSample | undefined,
): MeasuredSpace | undefined {
  if (usage === undefined || volume === undefined) {
    return undefined;
  }
  return {
    allowance: user.quota,
    used: usage.used,
    usable: UsableSpace.of({ allowance: user.quota, used: usage.used, volume: volume.space }),
    measuredAt: usage.sampledAt,
  };
}

// the share of the quota a figure stands for, as a CSS width
function shareOfQuota(bytes: number, space: MeasuredSpace): string {
  const quota = space.allowance.toBytes();
  const percent = quota === 0 ? 0 : Math.min(100, (bytes / quota) * 100);
  return `${percent.toFixed(1)}%`;
}

// The gauge of the quota: what is used, then what is free, and hatched what
// the disk can no longer hold once it runs short of the promise.
function gauge(space: MeasuredSpace, viewer: Viewer): RawHtml {
  const quota = space.allowance.toBytes();
  const used = space.used.toBytes();
  const beyond = Math.max(0, quota - used - space.usable.free.toBytes());
  return html`<div class="gauge" role="img" aria-label="${viewer.t('{used} used of your {quota} quota', {
    used: formatBytes(used, viewer),
    quota: formatBytes(quota, viewer),
  })}"><span class="used" style="width: ${shareOfQuota(used, space)}"></span>${space.usable.limit === 'disk' && beyond > 0
    ? html`<span class="beyond" style="width: ${shareOfQuota(beyond, space)}"></span>`
    : html``}</div>`;
}

// How fresh the reading is, and when the hourly pass reads it again.
function freshness(space: MeasuredSpace, viewer: Viewer, now: string): RawHtml {
  const schedule = scheduleOf(SAMPLE_COMMAND);
  const next = schedule === undefined ? undefined : nextRunAfter(schedule, now, viewer);
  const ago = viewer.t('Measured {ago}.', { ago: formatAgo(space.measuredAt, now, viewer) });
  return html`<p class="muted">${ago}${next === undefined
    ? html``
    : html` ${viewer.t('Next measure at {time}.', { time: formatClock(next, viewer) })}`}</p>`;
}

// What a member reads about their space on their home page: the free space
// first, the gauge of their quota, and how fresh the reading is.
export function memberSpace(
  space: MeasuredSpace | undefined,
  viewer: Viewer,
  now: string,
): RawHtml {
  if (space === undefined) {
    return html`<p class="muted">${viewer.t('Space not measured yet.')}</p>`;
  }
  return html`<section class="space">
<p class="space-free">${sentence(viewer.t, '{free} free', {
    free: html`<b>${formatBytes(space.usable.free.toBytes(), viewer)}</b>`,
  })}</p>
${gauge(space, viewer)}
<p>${viewer.t('{used} used of your {quota} quota', {
    used: formatBytes(space.used.toBytes(), viewer),
    quota: formatBytes(space.allowance.toBytes(), viewer),
  })}</p>
${freshness(space, viewer, now)}
</section>${diskWarning(space.usable.limit, viewer)}`;
}

// The admin's side of the same rule, after the "using X of Y" sentence. Says
// nothing until the volume has been read too.
export function leftToFill(space: MeasuredSpace | undefined, viewer: Viewer): RawHtml {
  if (space === undefined) {
    return html``;
  }
  const free = formatBytes(space.usable.free.toBytes(), viewer);
  switch (space.usable.limit) {
    case 'allowance':
      return html`${viewer.t('{free} left to fill.', { free })}`;
    case 'disk':
      return html`${viewer.t('{free} left to fill: the box is running out of disk, so the quota can no longer be reached.', { free })}`;
  }
}

// Said only when the disk, not the allowance, is what stops the member.
function diskWarning(limit: SpaceLimit, viewer: Viewer): RawHtml {
  switch (limit) {
    case 'allowance':
      return html``;
    case 'disk':
      return html`
<p class="flash warn">${viewer.t('The box is running out of disk, so your quota can no longer be reached.')}</p>`;
  }
}
