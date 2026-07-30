import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DebridApiKey } from '../../../src/domain/ddl/DebridApiKey.js';
import { FsDebridKeyPair } from '../../../src/infrastructure/system/FsDebridKeyPair.js';
import {
  DebridKeyCipherError,
  RsaDebridKeyCipher,
} from '../../../src/infrastructure/system/RsaDebridKeyCipher.js';

const RAW = 'abcdef0123456789ABCDEF';

let dir: string;
let pub: string;
let priv: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-debrid-keys-'));
  pub = join(dir, 'debrid-pub.pem');
  priv = join(dir, 'debrid-key.pem');
});

describe('debrid key pair provisioning', () => {
  it('should_generate_a_usable_pair_with_a_root_only_private_half', async () => {
    await new FsDebridKeyPair(pub, priv).ensurePair();

    expect(readFileSync(priv, 'utf8')).toContain('BEGIN PRIVATE KEY');
    expect(readFileSync(pub, 'utf8')).toContain('BEGIN PUBLIC KEY');
    // the private half must not be readable by group or other
    expect(statSync(priv).mode & 0o077).toBe(0);
    // the portal (another uid) must be able to read the public half
    expect(statSync(pub).mode & 0o044).toBe(0o044);
  });

  it('should_never_regenerate_over_an_existing_private_key', async () => {
    const keys = new FsDebridKeyPair(pub, priv);
    await keys.ensurePair();
    const first = readFileSync(priv, 'utf8');

    await keys.ensurePair();
    await keys.ensurePair();

    // regenerating would silently orphan every stored key
    expect(readFileSync(priv, 'utf8')).toBe(first);
  });

  it('should_rederive_a_missing_public_half_instead_of_minting_a_new_pair', async () => {
    const keys = new FsDebridKeyPair(pub, priv);
    await keys.ensurePair();
    const privateBefore = readFileSync(priv, 'utf8');
    const publicBefore = readFileSync(pub, 'utf8');
    execFileSync('rm', [pub]);

    await keys.ensurePair();

    expect(readFileSync(priv, 'utf8')).toBe(privateBefore);
    expect(readFileSync(pub, 'utf8')).toBe(publicBefore); // derived, identical
  });
});

describe('RsaDebridKeyCipher', () => {
  it('should_round_trip_a_key_through_seal_and_open', async () => {
    await new FsDebridKeyPair(pub, priv).ensurePair();
    const cipher = new RsaDebridKeyCipher(pub, priv);

    const sealed = await cipher.encrypt(DebridApiKey.parse(RAW));

    // what lands in the database is inert base64, not the key
    expect(sealed).not.toContain(RAW);
    expect(sealed).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect((await cipher.decrypt(sealed)).reveal()).toBe(RAW);
  });

  it('should_seal_differently_every_time_so_equal_keys_are_not_correlatable', async () => {
    await new FsDebridKeyPair(pub, priv).ensurePair();
    const cipher = new RsaDebridKeyCipher(pub, priv);
    const key = DebridApiKey.parse(RAW);

    // OAEP is randomized: two users with the same key must not produce the same
    // ciphertext, or the database would leak that fact
    expect(await cipher.encrypt(key)).not.toBe(await cipher.encrypt(key));
  });

  it('should_fail_actionably_when_the_stored_key_belongs_to_another_pair', async () => {
    await new FsDebridKeyPair(pub, priv).ensurePair();
    const sealed = await new RsaDebridKeyCipher(pub, priv).encrypt(DebridApiKey.parse(RAW));
    // the restore-without-the-PEM case: a brand new pair replaces the old one
    const otherPub = join(dir, 'other-pub.pem');
    const otherPriv = join(dir, 'other-key.pem');
    await new FsDebridKeyPair(otherPub, otherPriv).ensurePair();

    await expect(new RsaDebridKeyCipher(otherPub, otherPriv).decrypt(sealed)).rejects.toThrow(
      DebridKeyCipherError,
    );
  });

  it('should_report_a_missing_key_file_without_leaking_anything', async () => {
    writeFileSync(pub, 'not a pem');

    await expect(
      new RsaDebridKeyCipher(join(dir, 'absent.pem'), priv).encrypt(DebridApiKey.parse(RAW)),
    ).rejects.toThrow(/public key unreadable/);
  });
});
