export class FirewallRolledBackError extends Error {
  constructor() {
    super(
      'firewall apply rolled back: the new ruleset broke the SSH lifeline probe; previous rules restored',
    );
    this.name = 'FirewallRolledBackError';
  }
}
