import type { DiskUsagePass } from '../application/user/SampleDiskUsage.js';

// One thing an hourly pass could not do although it went on, as the operator
// reads it: the worker logs it, `kobox sample-disk-usage` prints it. Both say
// it from here, so they say the same thing.
export interface PassWarning {
  readonly message: string;
  readonly context: Readonly<Record<string, string>>;
}

export function diskUsagePassWarnings(pass: DiskUsagePass): readonly PassWarning[] {
  return [
    // skipped, the volume and these members keep their previous sample
    ...(pass.volumeError === undefined
      ? []
      : [{ message: 'disk usage: volume not measured', context: { error: pass.volumeError } }]),
    ...pass.unmeasured.map((member) => ({
      message: 'disk usage: member not measured',
      context: { username: member.username.value, error: member.error },
    })),
    // the member only sees an older list; the operator is told why
    ...pass.staleSnapshots.map((stale) => ({
      message: 'space cleanup: list not refreshed',
      context: { username: stale.username.value, cause: stale.cause, error: stale.error },
    })),
    // a member past the line may have missed their mail or their cleanup
    ...pass.unwatched.map((member) => ({
      message: 'space watch: member not watched',
      context: { username: member.username.value, error: member.error },
    })),
  ];
}

// A warning on one line: each value quoted, since an error holds spaces.
export function warningLine(warning: PassWarning): string {
  const fields = Object.entries(warning.context).map(
    ([key, value]) => `${key}=${JSON.stringify(value)}`,
  );
  return [warning.message, ...fields].join(' ');
}
