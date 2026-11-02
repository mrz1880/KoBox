import { beforeEach, describe, expect, it } from 'vitest';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
});

async function membersPage(language = 'en'): Promise<string> {
  const response = await world.server.inject({
    method: 'GET',
    url: '/admin/users',
    headers: { cookie: admin.cookie, 'accept-language': language },
  });
  return response.body;
}

// the values the form starts from, as the admin will see them
function fieldValue(body: string, name: string): string | undefined {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(body)?.[1];
}

describe('the cleanup rule on the members page', () => {
  it('should_start_the_form_from_the_default_rule_until_an_admin_sets_one', async () => {
    const body = await membersPage();

    expect(body).toContain('<form class="card" method="post" action="/admin/users/seed-rule">');
    expect(fieldValue(body, 'ratio')).toBe('2');
    expect(fieldValue(body, 'days')).toBe('7');
  });

  it('should_start_the_form_from_the_rule_an_admin_set', async () => {
    await world.seedRule.save(SeedRule.of({ ratio: 1.5, days: 14 }));

    const body = await membersPage();

    expect(fieldValue(body, 'ratio')).toBe('1.5');
    expect(fieldValue(body, 'days')).toBe('14');
    expect(body).toContain('once it has given back 1.5 times its size and finished at least 14 days ago');
  });
});

async function submit(
  fields: Record<string, string>,
  language = 'en',
): Promise<{ readonly status: number; readonly flash: string | null }> {
  const response = await world.server.inject({
    method: 'POST',
    url: '/admin/users/seed-rule',
    headers: {
      cookie: admin.cookie,
      'accept-language': language,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: form(fields),
  });
  const location = new URL(response.headers.location ?? '/', 'https://box.example.org');
  return { status: response.statusCode, flash: location.searchParams.get('flash') };
}

describe('setting the cleanup rule', () => {
  it('should_hand_a_valid_rule_to_the_worker', async () => {
    const sent = await submit({ _csrf: admin.csrf, ratio: '1.5', days: '14' });

    expect(sent.status).toBe(303);
    expect(sent.flash).toBe('Cleanup rule saved. The next hourly pass applies it.');
    expect(world.queue.jobs).toEqual([{ type: 'set-seed-rule', payload: { ratio: 1.5, days: 14 } }]);
  });

  it.each([
    { ratio: '0.05', days: '7' },
    { ratio: '2', days: '366' },
    { ratio: '2', days: '1.5' },
    { ratio: 'lots', days: '7' },
    { ratio: '', days: '7' },
  ])('should_refuse_a_rule_out_of_bounds_without_enqueueing_%o', async (fields) => {
    const sent = await submit({ _csrf: admin.csrf, ...fields });

    expect(sent.status).toBe(303);
    expect(sent.flash).toBe(
      'Nothing was saved: the ratio goes from 0.1 to 100.0, the days from 1 to 365.',
    );
    expect(world.queue.jobs).toEqual([]);
  });

  it('should_require_csrf_to_change_it', async () => {
    const sent = await submit({ ratio: '1.5', days: '14' });

    expect(sent.status).toBe(403);
    expect(world.queue.jobs).toEqual([]);
  });

  it('should_refuse_a_member_who_is_not_an_admin', async () => {
    const member = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/seed-rule',
      headers: { cookie: member.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: member.csrf, ratio: '1.5', days: '14' }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toEqual([]);
  });
});

describe('the cleanup rule in French', () => {
  it('should_explain_the_rule_in_french', async () => {
    const body = await membersPage('fr-FR');

    expect(body).toContain('Règle de nettoyage');
    expect(body).toContain(
      'Un torrent terminé peut être nettoyé une fois qu’il a rendu 2,0 fois sa taille et fini depuis au moins 7 jours ; les membres confirment toujours, sauf s’ils ont choisi le nettoyage automatique.',
    );
  });

  it.each([
    [{ ratio: '1.5', days: '14' }, 'Règle de nettoyage enregistrée. Le prochain passage horaire l’applique.'],
    [
      { ratio: '0', days: '14' },
      'Rien n’a été enregistré : le ratio va de 0,1 à 100,0, les jours de 1 à 365.',
    ],
  ])('should_confirm_or_refuse_in_the_admins_language_%o', async (fields, french) => {
    const sent = await submit({ _csrf: admin.csrf, ...fields }, 'fr-FR');

    expect(sent.flash).toBe(french);
  });
});
