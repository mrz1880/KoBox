import { beforeEach, describe, expect, it } from 'vitest';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { VolumeSpace } from '../../../src/domain/user/VolumeSpace.js';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

const MEASURED_AT = '2026-10-30 19:00:00';

let world: PortalWorld;
let member: AgentSession;

// alice's allowance is 412 GiB in the world
async function measured(usedGib: number, diskFreeGib: number): Promise<void> {
  await world.diskSamples.save({
    username: Username.parse('alice'),
    used: Quota.gib(usedGib),
    sampledAt: MEASURED_AT,
  });
  await world.volumeSamples.save({
    space: VolumeSpace.of({ free: Quota.gib(diskFreeGib), size: Quota.gib(3200) }),
    measuredAt: MEASURED_AT,
  });
}

async function homeOf(session: AgentSession, language = 'en'): Promise<string> {
  const response = await world.server.inject({
    method: 'GET',
    url: '/',
    headers: { cookie: session.cookie, 'accept-language': language },
  });
  return response.body;
}

beforeEach(async () => {
  world = await buildPortalWorld();
  member = await loginAs(world, 'alice');
});

describe("a member's usable space on their home page", () => {
  it('should_say_how_much_the_member_can_still_fill_and_when_it_was_measured', async () => {
    await measured(188, 1000);

    expect(await homeOf(member)).toContain(
      '224 GiB free of your 412 GiB (188 GiB used), measured 2026-10-30 19:00:00.',
    );
  });

  // a stale or invented figure is worse than none
  it('should_say_the_space_is_not_measured_before_the_first_pass', async () => {
    expect(await homeOf(member)).toContain('Space not measured yet.');
  });

  // the allowances add up to more than the disk: once it runs short, the
  // allowance is a promise the box can no longer keep
  it('should_say_the_disk_is_the_limit_once_it_holds_less_than_the_allowance', async () => {
    await measured(188, 50);

    const body = await homeOf(member);

    expect(body).toContain('50 GiB free of your 412 GiB (188 GiB used)');
    expect(body).toContain(
      'The box is running out of disk, so your allowance can no longer be reached.',
    );
  });

  it('should_not_mention_the_disk_while_the_allowance_is_the_limit', async () => {
    await measured(188, 1000);

    expect(await homeOf(member)).not.toContain('running out of disk');
  });

  it('should_say_the_usable_space_in_french_to_a_french_browser', async () => {
    await measured(188, 50);

    const body = await homeOf(member, 'fr-FR');

    expect(body).toContain('50 Gio libres sur vos 412 Gio (188 Gio utilisés), mesuré le 2026-10-30 19:00:00.');
    expect(body).toContain(
      'Le disque de la box arrive à saturation : votre allocation ne peut plus être atteinte.',
    );
  });

  it('should_say_the_space_is_not_measured_yet_in_french', async () => {
    expect(await homeOf(member, 'fr-FR')).toContain('Espace pas encore mesuré.');
  });
});
