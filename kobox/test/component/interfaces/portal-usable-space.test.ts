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

describe("an admin's view of a member's space", () => {
  let admin: AgentSession;

  beforeEach(async () => {
    admin = await loginAs(world, 'boss');
  });

  async function pageOf(url: string, language = 'en'): Promise<string> {
    const response = await world.server.inject({
      method: 'GET',
      url,
      headers: { cookie: admin.cookie, 'accept-language': language },
    });
    return response.body;
  }

  it('should_add_what_the_member_can_still_fill_to_the_storage_sentence', async () => {
    await measured(188, 1000);

    const body = await pageOf('/admin/users/alice');

    expect(body).toContain('Using 188 GiB of 412 GiB');
    expect(body).toContain('224 GiB left to fill.');
  });

  // the sample is in bytes: a raw division showed every decimal place
  it('should_round_what_the_member_uses_like_every_other_size', async () => {
    await world.diskSamples.save({
      username: Username.parse('alice'),
      used: Quota.bytes(1.5 * 1024 ** 3 + 123),
      sampledAt: MEASURED_AT,
    });

    expect(await pageOf('/admin/users/alice')).toContain('Using 1.5 GiB of 412 GiB');
  });

  it('should_tell_the_admin_when_the_disk_is_what_limits_the_member', async () => {
    await measured(188, 50);

    expect(await pageOf('/admin/users/alice')).toContain(
      '50 GiB left to fill: the box is running out of disk, so the allowance can no longer be reached.',
    );
  });

  it('should_say_what_the_member_can_still_fill_in_french', async () => {
    await measured(188, 50);

    expect(await pageOf('/admin/users/alice', 'fr-FR')).toContain(
      '50 Gio encore disponibles : le disque de la box arrive à saturation, l’allocation ne peut plus être atteinte.',
    );
  });

  it('should_list_what_each_member_uses_and_can_still_fill_next_to_the_allowance', async () => {
    await measured(188, 1000);

    const body = await pageOf('/admin/users');

    expect(body).toContain('<th>Used</th><th>Free</th>');
    expect(body).toContain('<td class="num">188 GiB</td>');
    expect(body).toContain('<td class="num">224 GiB</td>');
  });

  it('should_mark_a_member_the_disk_limits_in_the_free_column', async () => {
    await measured(188, 50);

    expect(await pageOf('/admin/users')).toContain(
      '<td class="num">50 GiB <span class="chip warn">limited by the disk</span></td>',
    );
  });

  // boss has never been measured: the list says so rather than show nothing
  it('should_say_a_member_has_not_been_measured_yet_in_the_list', async () => {
    await measured(188, 1000);

    expect(await pageOf('/admin/users')).toContain('<span class="muted">not measured</span>');
  });

  // alice and boss hold 412 GiB each: set beside the disk, the total shows
  // whether the box promised more than it has
  it('should_set_the_free_disk_beside_the_total_of_the_allowances', async () => {
    await measured(188, 1000);

    expect(await pageOf('/admin/users')).toContain(
      'Disk: 1000 GiB free of 3.13 TiB. Allowances add up to 824 GiB.',
    );
  });

  it('should_say_the_disk_is_not_measured_before_the_first_pass', async () => {
    expect(await pageOf('/admin/users')).toContain(
      'Disk not measured yet. Allowances add up to 824 GiB.',
    );
  });

  it('should_show_the_space_columns_and_the_box_line_in_french', async () => {
    await measured(188, 50);

    const body = await pageOf('/admin/users', 'fr-FR');

    expect(body).toContain('<th>Utilisé</th><th>Libre</th>');
    expect(body).toContain('<span class="chip warn">limité par le disque</span>');
    expect(body).toContain('<span class="muted">non mesuré</span>');
    expect(body).toContain('Disque : 50 Gio libres sur 3,13 Tio. Les allocations totalisent 824 Gio.');
  });

  it('should_say_the_disk_is_not_measured_yet_in_french', async () => {
    expect(await pageOf('/admin/users', 'fr-FR')).toContain('Disque pas encore mesuré.');
  });

  it('should_name_the_allowance_unit_in_french_in_the_list', async () => {
    expect(await pageOf('/admin/users', 'fr-FR')).toContain('<td class="num">412 Gio</td>');
  });
});
