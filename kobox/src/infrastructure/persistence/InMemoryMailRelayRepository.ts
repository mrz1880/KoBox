import type {
  MailRelayRepository,
  MailRelaySettings,
} from '../../application/maintenance/ConfigureMailRelay.js';

export class InMemoryMailRelayRepository implements MailRelayRepository {
  private settings: MailRelaySettings | undefined;

  get(): Promise<MailRelaySettings | undefined> {
    return Promise.resolve(this.settings);
  }

  save(settings: MailRelaySettings): Promise<void> {
    this.settings = settings;
    return Promise.resolve();
  }
}
