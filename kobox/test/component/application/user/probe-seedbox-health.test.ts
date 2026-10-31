import { beforeEach, describe, expect, it } from 'vitest';
import { ProbeSeedboxHealth } from '../../../../src/application/user/ProbeSeedboxHealth.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeHealthProbe } from '../../../../src/infrastructure/system/fakes/FakeHealthProbe.js';
import { aUser } from '../../../builders/UserBuilder.js';

let repo: InMemoryUserRepository;
let health: FakeHealthProbe;
let probe: ProbeSeedboxHealth;

beforeEach(() => {
  repo = new InMemoryUserRepository();
  health = new FakeHealthProbe();
  probe = new ProbeSeedboxHealth({ repo, health });
});

describe('probing the seedbox health', () => {
  it('should_probe_rtorrent_and_the_scgi_socket_of_an_active_member', async () => {
    await repo.save(aUser().withScgiPort(51101).build());

    const checks = await probe.execute();

    expect(checks.map((check) => check.name)).toEqual([
      'process:rtorrent',
      'socket:127.0.0.1:51101',
    ]);
  });

  // a socket on a port number said nothing about whose rTorrent was down
  it('should_name_the_member_whose_socket_each_probe_reaches', async () => {
    await repo.save(aUser().withUsername('alice').withScgiPort(51101).build());

    const checks = await probe.execute();

    expect(checks.map((check) => check.member?.value)).toEqual([undefined, 'alice']);
  });

  // rtorrent runs one instance per member: with nobody to serve, its absence is
  // the expected state, not a failure
  it.each([
    { situation: 'no account exists yet', members: [] },
    { situation: 'every member is suspended', members: [aUser().suspended()] },
  ])('should_not_expect_rtorrent_when_$situation', async ({ members }) => {
    for (const member of members) {
      await repo.save(member);
    }

    const checks = await probe.execute();

    expect(checks).toEqual([]);
  });
});
