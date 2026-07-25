import type { SessionStorePort, SessionTokenPort } from '../../domain/portal/ports.js';

interface Deps {
  readonly sessions: SessionStorePort;
  readonly tokens: SessionTokenPort;
}

export class Logout {
  constructor(private readonly deps: Deps) {}

  async execute(command: { readonly token: string }): Promise<void> {
    await this.deps.sessions.delete(this.deps.tokens.hashToken(command.token));
  }
}
