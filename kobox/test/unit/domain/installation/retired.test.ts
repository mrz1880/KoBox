import { describe, expect, it } from 'vitest';
import { RETIRED_SERVICES } from '../../../../src/domain/installation/retired.js';

describe('RETIRED_SERVICES', () => {
  // Exactly what the aria2 installer of the debrid downloads put on a box:
  // a path that drifts from it leaves the daemon running after an upgrade.
  it('should_name_everything_the_retired_download_engine_left_on_a_box', () => {
    expect(RETIRED_SERVICES).toEqual([
      {
        unit: 'kobox-aria2',
        unitFile: '/etc/systemd/system/kobox-aria2.service',
        files: ['/etc/kobox/aria2.conf'],
        dirs: ['/var/lib/kobox-aria2'],
      },
    ]);
  });
});
