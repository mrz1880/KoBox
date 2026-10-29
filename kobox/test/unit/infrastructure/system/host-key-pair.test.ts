import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST_PRIVATE_KEY,
  DEFAULT_HOST_PUBLIC_KEY,
} from '../../../../src/infrastructure/system/HostKeyPair.js';

describe('host key pair location', () => {
  // A box in production holds its private half at exactly this path, and every
  // sealed password in its database opens only with it: moving the default
  // would make the installer mint a new pair and orphan all of them.
  it('should_keep_the_pair_where_every_installed_box_already_has_it', () => {
    expect(DEFAULT_HOST_PUBLIC_KEY).toBe('/etc/kobox/debrid-pub.pem');
    expect(DEFAULT_HOST_PRIVATE_KEY).toBe('/etc/kobox/debrid-key.pem');
  });
});
