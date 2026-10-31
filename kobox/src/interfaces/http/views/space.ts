import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import type { Quota } from '../../../domain/user/Quota.js';
import { UsableSpace, type SpaceLimit } from '../../../domain/user/UsableSpace.js';
import type { DiskUsageSample, VolumeSample } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { formatBytes } from './bytes.js';
import { formatMoment } from './moment.js';
import type { Viewer } from './layout.js';

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

// The one sentence a member reads about their space, on their home page.
export function memberSpace(space: MeasuredSpace | undefined, viewer: Viewer): RawHtml {
  if (space === undefined) {
    return html`<p class="muted">${viewer.t('Space not measured yet.')}</p>`;
  }
  return html`<p>${viewer.t('{free} free of your {allowance} ({used} used), measured {at}.', {
    free: formatBytes(space.usable.free.toBytes(), viewer),
    allowance: formatBytes(space.allowance.toBytes(), viewer),
    used: formatBytes(space.used.toBytes(), viewer),
    at: formatMoment(space.measuredAt, viewer),
  })}</p>${diskWarning(space.usable.limit, viewer)}`;
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
      return html`${viewer.t('{free} left to fill: the box is running out of disk, so the allowance can no longer be reached.', { free })}`;
  }
}

// Said only when the disk, not the allowance, is what stops the member.
function diskWarning(limit: SpaceLimit, viewer: Viewer): RawHtml {
  switch (limit) {
    case 'allowance':
      return html``;
    case 'disk':
      return html`
<p class="flash">${viewer.t('The box is running out of disk, so your allowance can no longer be reached.')}</p>`;
  }
}
