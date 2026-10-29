import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Password } from '../../../src/domain/user/Password.js';
import { FsHostKeyPair } from '../../../src/infrastructure/system/HostKeyPair.js';
import { RsaPasswordCipher } from '../../../src/infrastructure/system/RsaPasswordCipher.js';

const RAW = 'correct horse battery staple';

let pub: string;
let priv: string;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kobox-password-cipher-'));
  pub = join(dir, 'debrid-pub.pem');
  priv = join(dir, 'debrid-key.pem');
  await new FsHostKeyPair(pub, priv).ensurePair();
});

describe('RsaPasswordCipher', () => {
  it('should_hand_the_worker_back_the_password_the_portal_sealed', async () => {
    const cipher = new RsaPasswordCipher(pub, priv);

    const sealed = await cipher.seal(Password.parse(RAW));

    // what waits in the job queue is inert base64, not the password
    expect(sealed).not.toContain(RAW);
    expect(sealed).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect((await cipher.open(sealed)).reveal()).toBe(RAW);
  });

  it('should_seal_the_longest_password_allowed_even_in_four_byte_characters', async () => {
    const cipher = new RsaPasswordCipher(pub, priv);
    const longest = Password.parse('\u{1F511}'.repeat(50));

    expect((await cipher.open(await cipher.seal(longest))).reveal()).toBe(longest.reveal());
  });
});
