import { describe, expect, it } from 'vitest';
import { InMemorySiteSettingsRepository } from '../../../../src/infrastructure/persistence/InMemorySiteSettingsRepository.js';
import { SiteSettingsWithInstallDefault } from '../../../../src/infrastructure/persistence/SiteSettingsWithInstallDefault.js';

const INSTALLED = { domain: 'box.example.net', email: 'ops@example.net' };

describe('site settings with the install-time default', () => {
  // a box installed with KOBOX_LE_DOMAIN got its certificate, and the Domain
  // page still said no public name was set: it read only what was stored
  it('should_answer_the_name_the_box_was_installed_with_when_none_is_stored', async () => {
    const site = new SiteSettingsWithInstallDefault(new InMemorySiteSettingsRepository(), INSTALLED);

    expect(await site.get()).toEqual(INSTALLED);
  });

  it('should_answer_what_an_admin_stored_over_the_install_time_name', async () => {
    const site = new SiteSettingsWithInstallDefault(new InMemorySiteSettingsRepository(), INSTALLED);
    const chosen = { domain: 'other.example.org', email: 'admin@example.org' };

    await site.save(chosen);

    expect(await site.get()).toEqual(chosen);
  });
});
