import type { CronSchedule, CronTime } from '../../../domain/maintenance/CronSchedule.js';
import { stampOf } from '../../../domain/shared/stamp.js';
import type { Reader } from './layout.js';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
// the furthest a schedule's next run is looked for: every KoBox entry runs at
// least once a day, and a week covers a weekly one too
const LOOKAHEAD_MINUTES = 7 * MINUTES_PER_DAY;

function dateOf(stamp: string): Date {
  return new Date(`${stamp.replace(' ', 'T')}Z`);
}

// Stamps are written in UTC (see stampOf); a reader expects the box's own
// clock, in their own words.
export function formatMoment(stamp: string, reader: Reader): string {
  return dateOf(stamp).toLocaleString(reader.language.value, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: reader.zone,
  });
}

// the hour and minute alone, on the box's clock
export function formatClock(stamp: string, reader: Reader): string {
  return dateOf(stamp).toLocaleTimeString(reader.language.value, {
    timeStyle: 'short',
    timeZone: reader.zone,
  });
}

// How long ago, in the largest unit that keeps it a whole number.
export function formatAgo(stamp: string, now: string, reader: Reader): string {
  const minutes = Math.floor((dateOf(now).getTime() - dateOf(stamp).getTime()) / MS_PER_MINUTE);
  if (minutes < 1) {
    return reader.t('just now');
  }
  const ago = new Intl.RelativeTimeFormat(reader.language.value, { numeric: 'always' });
  if (minutes < MINUTES_PER_HOUR) {
    return ago.format(-minutes, 'minute');
  }
  if (minutes < MINUTES_PER_DAY) {
    return ago.format(-Math.floor(minutes / MINUTES_PER_HOUR), 'hour');
  }
  return ago.format(-Math.floor(minutes / MINUTES_PER_DAY), 'day');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A moment as the cron of the box sees it: its own clock, field by field.
function cronTimeOf(date: Date, zone: string): CronTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: WEEKDAYS.indexOf(String(parts.weekday)),
  };
}

// The next minute after `after` that the schedule runs at, read on the box's
// clock as its cron does; undefined beyond a week.
export function nextRunAfter(schedule: CronSchedule, after: string, reader: Reader): string | undefined {
  const start = dateOf(after);
  start.setUTCSeconds(0, 0);
  for (let minute = 1; minute <= LOOKAHEAD_MINUTES; minute += 1) {
    const candidate = new Date(start.getTime() + minute * MS_PER_MINUTE);
    if (schedule.runsAt(cronTimeOf(candidate, reader.zone))) {
      return stampOf(candidate);
    }
  }
  return undefined;
}
