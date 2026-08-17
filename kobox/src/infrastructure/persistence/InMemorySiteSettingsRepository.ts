import type { SiteSettings, SiteSettingsRepository } from '../../domain/installation/ports.js';

export class InMemorySiteSettingsRepository implements SiteSettingsRepository {
  private settings: SiteSettings | undefined;

  get(): Promise<SiteSettings | undefined> {
    return Promise.resolve(this.settings);
  }

  save(settings: SiteSettings): Promise<void> {
    this.settings = settings;
    return Promise.resolve();
  }
}
