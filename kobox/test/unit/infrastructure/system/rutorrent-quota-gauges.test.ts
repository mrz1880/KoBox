import { describe, expect, it } from 'vitest';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { FakeInstallHost } from '../../../../src/infrastructure/system/fakes/FakeInstallHost.js';
import { RutorrentQuotaGauges } from '../../../../src/infrastructure/system/RutorrentQuotaGauges.js';

describe('RutorrentQuotaGauges', () => {
  it('should_leave_the_members_gauge_in_their_rutorrent_profile', async () => {
    const files = new FakeInstallHost();

    await new RutorrentQuotaGauges(files).show(Username.parse('alice'), Quota.gib(37), Quota.gib(412));

    const gib = 1024 ** 3;
    expect(JSON.parse(files.contentAt('/var/lib/rutorrent/users/alice/kobox-quota.json') ?? '{}')).toEqual({
      total: 412 * gib,
      free: 375 * gib,
    });
  });
});
