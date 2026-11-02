import { beforeEach, describe, expect, it } from 'vitest';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

const alice = Username.parse('alice');

let world: PortalWorld;
let member: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  member = await loginAs(world, 'alice');
});

async function accountOf(language = 'en'): Promise<string> {
  const response = await world.server.inject({
    method: 'GET',
    url: '/access',
    headers: { cookie: member.cookie, 'accept-language': language },
  });
  return response.body;
}

function choiceOf(body: string): string | undefined {
  return /name="rule" value="(\w+)" checked/.exec(body)?.[1];
}

// the value a field of the rule form starts from
function fieldValue(body: string, name: string): string | undefined {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(body)?.[1];
}

async function submit(
  fields: Record<string, string>,
  language = 'en',
): Promise<{ readonly status: number; readonly flash: string | null }> {
  const response = await world.server.inject({
    method: 'POST',
    url: '/access/seed-rule',
    headers: {
      cookie: member.cookie,
      'accept-language': language,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: form(fields),
  });
  const location = new URL(response.headers.location ?? '/', 'https://box.example.org');
  return { status: response.statusCode, flash: location.searchParams.get('flash') };
}

describe('my cleanup rule in My account', () => {
  it('should_keep_a_member_on_the_box_rule_and_say_what_it_asks', async () => {
    const body = await accountOf();

    expect(body).toContain('<form class="card" method="post" action="/access/seed-rule">');
    expect(choiceOf(body)).toBe('box');
    expect(body).toContain('Use the box rule (ratio 2.0, 7 days)');
  });

  it('should_start_the_fields_from_the_box_rule_while_the_member_keeps_it', async () => {
    const body = await accountOf();

    expect(fieldValue(body, 'days')).toBe('7');
    expect(fieldValue(body, 'ratio')).toBe('2');
  });

  it('should_tick_the_rule_the_member_set_and_show_it_without_a_ratio', async () => {
    await world.spacePreferences.chooseSeedRule(alice, {
      kind: 'own',
      rule: SeedRule.of({ days: 14 }),
    });

    const body = await accountOf();

    expect(choiceOf(body)).toBe('own');
    expect(fieldValue(body, 'days')).toBe('14');
    expect(fieldValue(body, 'ratio')).toBe('');
  });

  // their tracker accounts carry the risk, and it is their call
  it('should_warn_that_a_low_ratio_can_cost_a_private_tracker_account', async () => {
    expect(await accountOf()).toContain(
      'A low ratio can cost you your account on a private tracker. It is your call.',
    );
  });
});

describe('setting my cleanup rule', () => {
  it('should_hand_a_rule_on_days_alone_to_the_worker_for_the_session_member', async () => {
    const sent = await submit({ _csrf: member.csrf, rule: 'own', days: '14', ratio: '' });

    expect(sent.status).toBe(303);
    expect(sent.flash).toBe('Saved. The next hourly pass applies it.');
    expect(world.queue.jobs).toEqual([
      { type: 'set-own-seed-rule', payload: { username: 'alice', rule: { ratio: null, days: 14 } } },
    ]);
  });

  it('should_hand_a_rule_with_a_ratio_to_the_worker', async () => {
    await submit({ _csrf: member.csrf, rule: 'own', days: '10', ratio: '1.5' });

    expect(world.queue.jobs).toEqual([
      { type: 'set-own-seed-rule', payload: { username: 'alice', rule: { ratio: 1.5, days: 10 } } },
    ]);
  });

  // the fields still hold numbers: keeping the box rule ignores them
  it('should_take_the_member_back_to_the_box_rule', async () => {
    const sent = await submit({ _csrf: member.csrf, rule: 'box', days: '14', ratio: '' });

    expect(sent.status).toBe(303);
    expect(world.queue.jobs).toEqual([
      { type: 'set-own-seed-rule', payload: { username: 'alice', rule: null } },
    ]);
  });

  it.each([
    { days: '0', ratio: '' },
    { days: '', ratio: '' },
    { days: '366', ratio: '' },
    { days: '1.5', ratio: '' },
    { days: '14', ratio: '0.05' },
    { days: '14', ratio: 'lots' },
  ])('should_refuse_a_rule_out_of_bounds_without_enqueueing_%o', async (fields) => {
    const sent = await submit({ _csrf: member.csrf, rule: 'own', ...fields });

    expect(sent.status).toBe(303);
    expect(sent.flash).toBe(
      'Nothing was saved: the days go from 1 to 365, the ratio, when you set one, from 0.1 to 100.',
    );
    expect(world.queue.jobs).toEqual([]);
  });

  it('should_refuse_a_choice_the_page_does_not_offer_without_enqueueing', async () => {
    const sent = await submit({ _csrf: member.csrf, rule: 'nobody', days: '14', ratio: '' });

    expect(sent.status).toBe(400);
    expect(world.queue.jobs).toEqual([]);
  });

  it('should_require_csrf_to_change_it', async () => {
    const sent = await submit({ rule: 'own', days: '14', ratio: '' });

    expect(sent.status).toBe(403);
    expect(world.queue.jobs).toEqual([]);
  });
});

describe('my cleanup rule in French', () => {
  it('should_offer_it_in_french', async () => {
    const body = await accountOf('fr-FR');

    expect(body).toContain('Ma règle de nettoyage');
    expect(body).toContain('Suivre la règle de la box (ratio 2,0, 7 jours)');
    expect(body).toContain('Ma propre règle');
    expect(body).toContain(
      'Un ratio bas peut vous coûter votre compte sur un tracker privé. C’est votre choix.',
    );
  });

  it.each([
    [{ days: '14', ratio: '' }, 'Enregistré. Le prochain passage horaire l’applique.'],
    [
      { days: '0', ratio: '' },
      'Rien n’a été enregistré : les jours vont de 1 à 365, le ratio, si vous en indiquez un, de 0,1 à 100.',
    ],
  ])('should_confirm_or_refuse_in_the_members_language_%o', async (fields, french) => {
    const sent = await submit({ _csrf: member.csrf, rule: 'own', ...fields }, 'fr-FR');

    expect(sent.flash).toBe(french);
  });
});
