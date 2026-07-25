export interface CertbotRequest {
  readonly domain: string;
  readonly email: string;
  readonly webroot: string;
  // test/E2E ACME server (pebble); production omits it and certbot uses its
  // built-in Let's Encrypt directory
  readonly acmeUrl?: string;
}

// One certificate issuance. Renewals do NOT go through here: the packaged
// certbot.timer owns them, with the rendered deploy hook reloading nginx.
export interface CertbotPort {
  obtain(request: CertbotRequest): Promise<void>;
}
