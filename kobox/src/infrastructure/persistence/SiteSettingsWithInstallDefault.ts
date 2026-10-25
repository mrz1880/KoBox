import type { SiteSettings, SiteSettingsRepository } from '../../domain/installation/ports.js';

// The one answer to "what is this box's public name": what an admin stored,
// else what the box was installed with (KOBOX_LE_DOMAIN and KOBOX_LE_EMAIL).
// The certificate, the links in mails and the Domain page all ask here, so the
// page never says "no public name" on a box that has its certificate.
export class SiteSettingsWithInstallDefault implements SiteSettingsRepository {
  constructor(
    private readonly stored: SiteSettingsRepository,
    private readonly installDefault: SiteSettings | undefined,
  ) {}

  async get(): Promise<SiteSettings | undefined> {
    return (await this.stored.get()) ?? this.installDefault;
  }

  save(settings: SiteSettings): Promise<void> {
    return this.stored.save(settings);
  }
}
